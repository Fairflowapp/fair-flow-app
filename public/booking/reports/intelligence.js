/**
 * Booking Intelligence dashboard. Uses existing appointments and schedules.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var filters = {
    locationIds: null,
    date: "this_week",
    customFrom: "",
    customTo: ""
  };
  var result = null;
  var status = "idle";
  var errorText = "";
  var openMenu = "";

  function compute() { return window.ffBookingReportsIntelligenceCompute || null; }
  function dates() { return window.ffBookingReportsCompute || null; }
  function repo() { return window.ffBookingAppointments || null; }
  function cal() { return window.ffBookingCalData || null; }
  function time() { return window.ffBookingTime || null; }
  function salesModel() { return window.ffBookingSalesModel || null; }

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
    var api = dates();
    var today = todayKey();
    if (api && typeof api.datePresets === "function" && today) return api.datePresets(today);
    return [{ value: "this_week", label: "This Week" }];
  }

  function dateLabel() {
    var opts = dateOptions();
    var hit = opts.find(function (row) { return row.value === filters.date; });
    return (hit && hit.label) || "Date";
  }

  function currentRange() {
    var api = dates();
    var today = todayKey();
    if (api && typeof api.rangeForPreset === "function") {
      return api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo);
    }
    return { fromKey: today, toKey: today };
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

  function money(value) {
    var intel = compute();
    if (intel && typeof intel.formatMoney === "function") return intel.formatMoney(value);
    var model = salesModel();
    if (model && typeof model.money === "function") return model.money(value);
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function hours(minutes) {
    var intel = compute();
    if (intel && typeof intel.formatHours === "function") return intel.formatHours(minutes);
    return String(Math.round((Number(minutes) || 0) / 6) / 10);
  }

  function locPopHtml() {
    var ids = selectedLocationIds();
    var rows = locations().map(function (row) {
      var on = ids.indexOf(row.id) !== -1;
      return (
        '<label class="ff-rpt-check" data-ff-intel-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-intel-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-intel-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-intel-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-intel-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-intel-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-intel-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-intel-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-intel-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-intel-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-intel-generate' +
          (status === "loading" ? " disabled" : "") + ">" +
          (status === "loading" ? "Generating…" : "Generate") +
        "</button>" +
      "</div>"
    );
  }

  function kpi(label, value, note) {
    return (
      '<div class="ff-rpt-kpi">' +
        '<p class="ff-rpt-kpi-value">' + escapeHtml(String(value)) + "</p>" +
        '<p class="ff-rpt-kpi-label">' + escapeHtml(label) + "</p>" +
        (note ? '<p class="ff-rpt-kpi-note">' + escapeHtml(note) + "</p>" : "") +
      "</div>"
    );
  }

  function barRow(label, value, max) {
    var width = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
      '<div class="ff-rpt-bar-row">' +
        '<span class="ff-rpt-bar-label">' + escapeHtml(label) + "</span>" +
        '<span class="ff-rpt-bar-track"><span class="ff-rpt-bar-fill" style="width:' + width + '%"></span></span>' +
        '<span class="ff-rpt-bar-value">' + escapeHtml(String(value)) + "</span>" +
      "</div>"
    );
  }

  function insightsHtml(report) {
    var lines = (report && report.insights) || [];
    if (!lines.length) return "";
    return (
      '<section class="ff-rpt-panel ff-rpt-insights">' +
        "<h2>Fair Flow insights</h2>" +
        "<ul>" + lines.map(function (line) {
          return "<li>" + escapeHtml(line) + "</li>";
        }).join("") + "</ul>" +
      "</section>"
    );
  }

  function appointmentsHtml(report) {
    var a = report.appointments;
    var extra = "";
    if (a.checkedIn || a.inService) {
      extra = kpi("Checked in", a.checkedIn) + kpi("In service", a.inService);
    }
    var noShowNote = a.noShow
      ? '<p class="ff-rpt-fine">No-show is counted when a visit is marked that way (' +
        escapeHtml(String(a.noShow)) +
        "). That status is not a complete front-desk workflow yet, so it is not treated as a headline KPI.</p>"
      : "";
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Appointments</h2>" +
        '<div class="ff-rpt-kpis">' +
          kpi("Total", a.total) +
          kpi("Completed", a.completed) +
          kpi("Scheduled", a.scheduled) +
          kpi("Confirmed", a.confirmed) +
          kpi("Cancelled", a.cancelled) +
          kpi("Cancellation rate", a.cancellationRate + "%") +
          extra +
        "</div>" +
        noShowNote +
      "</section>"
    );
  }

  function clientsHtml(report) {
    var c = report.clients;
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Clients</h2>" +
        '<div class="ff-rpt-kpis ff-rpt-kpis-2">' +
          kpi("New", c.newAppointments, c.newPercent + "% of appointments") +
          kpi("Returning", c.returningAppointments, c.returningPercent + "% of appointments") +
        "</div>" +
        '<p class="ff-rpt-fine">New vs returning uses the existing first-visit flag on each appointment.</p>' +
      "</section>"
    );
  }

  function sourcesHtml(report) {
    var intel = compute();
    var labels = (intel && intel.SOURCE_LABELS) || {};
    var keys = (intel && intel.KNOWN_SOURCES) || [];
    var counts = report.sources.counts || {};
    var max = 0;
    keys.forEach(function (key) {
      if (counts[key] > max) max = counts[key];
    });
    if (counts.other > max) max = counts.other;
    var rows = keys.map(function (key) {
      return barRow(labels[key] || key, counts[key] || 0, max || 1);
    }).join("");
    if (counts.other) rows += barRow(labels.other || "Other", counts.other, max || 1);
    return (
      '<section class="ff-rpt-panel ff-rpt-panel-secondary">' +
        "<h2>Booking source</h2>" +
        '<p class="ff-rpt-fine">Recorded on the appointment when present. New bookings are currently saved as front desk, so this is not a complete channel report yet.</p>' +
        '<div class="ff-rpt-bars">' + rows + "</div>" +
      "</section>"
    );
  }

  function requestedHtml(report) {
    var r = report.requested;
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Requested provider</h2>" +
        '<div class="ff-rpt-kpis ff-rpt-kpis-3">' +
          kpi("Requested lines", r.requestedLines) +
          kpi("Not requested", r.nonRequestedLines) +
          kpi("Requested", r.requestedPercent + "%") +
        "</div>" +
      "</section>"
    );
  }

  function utilizationHtml(report) {
    var u = report.utilization;
    var rows = (u.providers || []).map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(row.name || row.id) + "</td>" +
          "<td>" + escapeHtml(hours(row.workingMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.bookedMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.percent)) + "%</td>" +
          "<td>" + escapeHtml(hours(row.idleMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.gapMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.gapCount || 0)) + "</td>" +
          "<td>" + escapeHtml(hours(row.openEdgeMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.gapSharePercent)) + "%</td>" +
        "</tr>"
      );
    }).join("");
    var body = rows
      ? '<div class="ff-rpt-table-wrap ff-rpt-table-wrap-compact">' +
          '<table class="ff-rpt-table ff-rpt-table-compact ff-rpt-table-capacity">' +
            "<thead><tr>" +
              "<th>Provider</th><th>Working hrs</th><th>Booked hrs</th><th>Utilization</th>" +
              "<th>Idle hrs</th><th>Gap hrs</th><th>Gaps</th><th>Open-edge hrs</th><th>Gap share</th>" +
            "</tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>"
      : '<p class="ff-rpt-empty">No scheduled providers in this period.</p>';
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Provider capacity</h2>" +
        '<div class="ff-rpt-kpis">' +
          kpi("Working hours", hours(u.workingMinutes)) +
          kpi("Booked hours", hours(u.bookedMinutes)) +
          kpi("Idle hours", hours(u.idleMinutes)) +
          kpi("Calendar gap hours", hours((report.gaps && report.gaps.totalMinutes) || 0)) +
          kpi("Open-edge idle", hours(u.openEdgeMinutes || 0), "start/end of shifts") +
          kpi("Utilization", u.percent + "%", "booked ÷ working") +
        "</div>" +
        body +
        '<p class="ff-rpt-fine">Providers with scheduled hours, ranked by the most calendar gap time, then the most idle time. Overall utilization is total booked hours divided by total working hours. Calendar gaps are holes between visits; open-edge idle is unused time at the start or end of a working window.</p>' +
      "</section>"
    );
  }

  function gapsHtml(report) {
    var g = report.gaps;
    var cap = report.capacity;
    var most = g.mostGapProvider
      ? (g.mostGapProvider.firstName || String(g.mostGapProvider.name || "").split(/\s+/)[0] || g.mostGapProvider.name)
      : "—";
    var peak = g.peakPeriod && g.peakPeriod.label ? g.peakPeriod.label : "—";
    var estimate = cap.estimatedDollars == null
      ? '<p class="ff-rpt-fine">Estimated unused service capacity is shown only when booked services have both a price and a duration.</p>'
      : '<div class="ff-rpt-estimate">' +
          '<p class="ff-rpt-estimate-label">Estimated unused service capacity</p>' +
          '<p class="ff-rpt-estimate-value">' + escapeHtml(money(cap.estimatedDollars)) + "</p>" +
          '<p class="ff-rpt-fine">Estimate only: average booked service dollars per booked minute, multiplied by calendar gap minutes. Based on booked service value, not a guarantee.</p>' +
        "</div>";
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Calendar gaps and unused capacity</h2>" +
        '<p class="ff-rpt-fine">A calendar gap is unused working time between two booked visits. Open time at the start or end of a shift is idle, not a gap.</p>' +
        '<div class="ff-rpt-kpis">' +
          kpi("Gaps", g.count) +
          kpi("Gap hours", hours(g.totalMinutes)) +
          kpi("Small gap hours", hours(g.smallMinutes), "gaps of 30 minutes or less") +
          kpi("Larger gap hours", hours(g.largerMinutes), "gaps over 30 minutes") +
          kpi("Most gap time", most, g.mostGapProvider ? hours(g.mostGapProvider.minutes) + " hrs" : "") +
          kpi("Busiest gap window", peak) +
          kpi("Unused to gaps", cap.unusedPercent + "%", "of scheduled hours") +
        "</div>" +
        estimate +
      "</section>"
    );
  }

  function resultHtml() {
    if (errorText) return '<p class="ff-rpt-empty">' + escapeHtml(errorText) + "</p>";
    if (status === "idle") {
      return '<p class="ff-rpt-empty">Choose locations and a date, then Generate to see Booking Intelligence.</p>';
    }
    if (status === "loading") return '<p class="ff-rpt-empty">Reading appointments and schedules…</p>';
    if (!result) return '<p class="ff-rpt-empty">No report yet.</p>';
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
        "</div>" +
        insightsHtml(result) +
        appointmentsHtml(result) +
        clientsHtml(result) +
        requestedHtml(result) +
        utilizationHtml(result) +
        gapsHtml(result) +
        sourcesHtml(result) +
      "</div>"
    );
  }

  function html() {
    return (
      '<div class="ff-rpt-intel-head">' +
        "<h1>Booking Intelligence</h1>" +
        "<p>Actionable booking metrics from appointments, requested providers, and the live schedule. Sales Summary stays in the Sales list.</p>" +
      "</div>" +
      filtersHtml() +
      '<div class="ff-rpt-result" aria-live="polite">' + resultHtml() + "</div>"
    );
  }

  async function loadAppointments(ids, fromKey, toKey) {
    var api = repo();
    var intel = compute();
    if (!api) throw new Error("Appointments are not loaded.");
    if (!ids.length) return [];
    var keys = intel && typeof intel.dateKeysBetween === "function"
      ? intel.dateKeysBetween(fromKey, toKey)
      : [fromKey];
    if (!keys.length) return [];
    var seen = {};
    var rows = [];
    if (typeof api.getAppointmentsForDate !== "function") {
      throw new Error("Appointment range reads are not available.");
    }
    var i;
    for (i = 0; i < keys.length; i += 6) {
      var slice = keys.slice(i, i + 6);
      var batch = [];
      slice.forEach(function (dateKey) {
        ids.forEach(function (loc) {
          batch.push(api.getAppointmentsForDate(dateKey, loc));
        });
      });
      var parts = await Promise.all(batch);
      parts.forEach(function (list) {
        (list || []).forEach(function (row) {
          var id = row && String(row.appointmentId || "").trim();
          if (!id || seen[id]) return;
          seen[id] = true;
          rows.push(row);
        });
      });
    }
    return rows;
  }

  function loadProviders(ids, fromKey, toKey) {
    var board = cal();
    var intel = compute();
    var keys = intel && typeof intel.dateKeysBetween === "function"
      ? intel.dateKeysBetween(fromKey, toKey)
      : [];
    var byId = {};
    if (!board || typeof board.loadCalendarEmployees !== "function") return [];
    ids.forEach(function (loc) {
      keys.forEach(function (dateKey) {
        var staff = [];
        try {
          staff = board.loadCalendarEmployees(dateKey, loc) || [];
        } catch (_) {
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
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  async function generate() {
    var math = compute();
    var ids = selectedLocationIds();
    var range = currentRange();
    openMenu = "";
    status = "loading";
    errorText = "";
    result = null;
    paint();
    if (!ids.length) {
      status = "ready";
      errorText = "Choose a location.";
      paint();
      return;
    }
    if (filters.date === "custom" && !(range.fromKey && range.toKey)) {
      status = "ready";
      errorText = "Choose a start and end date.";
      paint();
      return;
    }
    var appointments = [];
    var providers = [];
    try {
      appointments = await loadAppointments(ids, range.fromKey, range.toKey);
      providers = loadProviders(ids, range.fromKey, range.toKey);
    } catch (err) {
      status = "ready";
      errorText = err && err.message ? err.message : "This report could not load.";
      paint();
      return;
    }
    result = math && typeof math.buildReport === "function"
      ? math.buildReport({
        appointments: appointments,
        providers: providers,
        fromKey: range.fromKey,
        toKey: range.toKey,
        locationIds: ids,
        todayKey: todayKey()
      })
      : null;
    status = "ready";
    paint();
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
    var t = ev.target;
    if (!t || typeof t.closest !== "function") return;
    var locRow = t.closest("[data-ff-intel-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-intel-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-intel-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-intel-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-intel-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-intel-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-intel-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-intel-date") || "this_week";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-intel-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-intel-pop]")) {
      ev.stopPropagation();
      return;
    }
    if (openMenu && t.closest("[data-ff-intel-filters]")) {
      if (!t.closest(".ff-rpt-dd")) {
        openMenu = "";
        paint();
      }
    }
  }

  function onHostChange(ev) {
    var t = ev.target;
    if (!t) return;
    var custom = t.getAttribute && t.getAttribute("data-ff-intel-custom");
    if (custom === "from") filters.customFrom = t.value || "";
    if (custom === "to") filters.customTo = t.value || "";
  }

  function paint() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (!Array.isArray(filters.locationIds)) {
      var all = allLocationIds();
      if (all.length) filters.locationIds = all;
    }
    host.innerHTML = html();
    if (!host.getAttribute("data-ff-intel-bound")) {
      host.setAttribute("data-ff-intel-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsIntelligence = {
    paint: paint
  };
})();
