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
  var patternView = "days";

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

  function hoursUnit(minutes) {
    return hours(minutes) + " h";
  }

  function displayValue(value) {
    if (value == null || value === "") return "—";
    if (typeof value === "number" && !Number.isFinite(value)) return "—";
    var text = String(value);
    if (text === "NaN" || text === "Infinity" || text === "-Infinity") return "—";
    return text;
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
        '<p class="ff-rpt-kpi-value">' + escapeHtml(displayValue(value)) + "</p>" +
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
    var raw = (report && report.insights) || [];
    var rank = window.ffBookingReportsInsightPriority;
    var lines = rank && typeof rank.presentInsights === "function"
      ? rank.presentInsights(raw)
      : raw.slice(0, 8);
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

  function overviewHtml(report) {
    var a = report.appointments || {};
    var u = report.utilization || {};
    var demand = report.serviceDemand || {};
    var behavior = report.clientBehavior || {};
    var working = u.workingMinutes || 0;
    var utilLabel = working > 0 ? String(u.percent) + "%" : "—";
    var value = demand.totals && demand.totals.bookedServiceValue > 0
      ? money(demand.totals.bookedServiceValue)
      : "—";
    var unique = behavior.identifiedClientCount || 0;
    var repeatShare = unique > 0 ? String(behavior.repeatInPeriodClientShare || 0) + "%" : "—";
    var extra = "";
    if (a.checkedIn || a.inService) {
      extra = kpi("Checked in", a.checkedIn) + kpi("In service", a.inService);
    }
    var noShowNote = a.noShow
      ? '<p class="ff-rpt-fine">No-show is counted when a visit is marked that way (' +
        escapeHtml(String(a.noShow)) +
        "). That status is not a complete front-desk workflow yet, so it is not treated as a headline KPI.</p>"
      : "";
    var emptyNote = !a.total
      ? '<p class="ff-rpt-empty">No appointments in this period. Provider hours below are scheduled working time only.</p>'
      : "";
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Overview</h2>" +
        '<p class="ff-rpt-fine">What happened and how scheduled provider time was used. Booked service value is the appointment price snapshot, not collected sales.</p>' +
        '<div class="ff-rpt-kpis">' +
          kpi("Appointments", a.total || 0) +
          kpi("Unique clients", unique, behavior.unidentifiedClientAppointmentCount ? "identified only" : "") +
          kpi("Utilization", utilLabel, working > 0 ? "booked ÷ working" : "no working hours") +
          kpi("Provider working hours", hoursUnit(working)) +
          kpi("Calendar gap hours", hoursUnit((report.gaps && report.gaps.totalMinutes) || 0)) +
          kpi("Booked service value", value) +
          kpi("Repeat-in-period share", repeatShare, unique ? "of unique clients" : "") +
        "</div>" +
        emptyNote +
        '<div class="ff-rpt-kpis ff-rpt-kpis-follow">' +
          kpi("Completed", a.completed || 0) +
          kpi("Cancelled", a.cancelled || 0) +
          kpi("Cancellation rate", (a.cancellationRate || 0) + "%") +
          extra +
        "</div>" +
        noShowNote +
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

  function civilDateLabel(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
    if (!m) return String(dateKey || "");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[Number(m[2]) - 1] + " " + Number(m[3]);
  }

  function weekdayLabel(key) {
    var api = window.ffBookingReportsCapacityPatterns;
    var labels = api && api.WEEKDAY_LABELS;
    return (labels && labels[key]) || key || "";
  }

  function patternToggleHtml() {
    return (
      '<div class="ff-rpt-view-toggle" role="tablist" aria-label="Capacity pattern view">' +
        '<button type="button" role="tab" aria-selected="' + (patternView === "days" ? "true" : "false") + '"' +
          ' class="' + (patternView === "days" ? "is-active" : "") + '" data-ff-intel-pattern="days">By day / weekday</button>' +
        '<button type="button" role="tab" aria-selected="' + (patternView === "hours" ? "true" : "false") + '"' +
          ' class="' + (patternView === "hours" ? "is-active" : "") + '" data-ff-intel-pattern="hours">By time of day</button>' +
      "</div>"
    );
  }

  function patternHighlights(summary) {
    if (!summary) return "";
    var cards = [];
    if (summary.strongestDay) {
      cards.push(kpi("Strongest day", civilDateLabel(summary.strongestDay.dateKey), summary.strongestDay.percent + "% utilized"));
    }
    if (summary.weakestDay) {
      cards.push(kpi("Least utilized day", civilDateLabel(summary.weakestDay.dateKey), summary.weakestDay.percent + "% utilized"));
    }
    if (summary.mostGapHour) {
      cards.push(kpi("Most gap time", summary.mostGapHour.shortLabel || summary.mostGapHour.label, hoursUnit(summary.mostGapHour.gapMinutes)));
    }
    if (!cards.length) return "";
    return '<div class="ff-rpt-kpis">' + cards.join("") + "</div>";
  }

  function patternTable(headers, rowsHtml, extraClass) {
    if (!rowsHtml) return "";
    return (
      '<div class="ff-rpt-table-wrap ff-rpt-table-wrap-compact">' +
        '<table class="ff-rpt-table ff-rpt-table-compact' + (extraClass ? " " + extraClass : "") + '">' +
          "<thead><tr>" + headers.map(function (h) { return "<th>" + escapeHtml(h) + "</th>"; }).join("") + "</tr></thead>" +
          "<tbody>" + rowsHtml + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  function weekdayRowsHtml(weekdays) {
    return (weekdays || []).map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(row.label || weekdayLabel(row.weekday)) + "</td>" +
          "<td>" + escapeHtml(String(row.dateCount || 0)) + "</td>" +
          "<td>" + escapeHtml(hours(row.workingMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.bookedMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.percent)) + "%</td>" +
          "<td>" + escapeHtml(hours(row.idleMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.gapMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.gapSharePercent)) + "%</td>" +
        "</tr>"
      );
    }).join("");
  }

  function dayRowsHtml(days) {
    return (days || []).map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(civilDateLabel(row.dateKey)) + "</td>" +
          "<td>" + escapeHtml(weekdayLabel(row.weekday)) + "</td>" +
          "<td>" + escapeHtml(hours(row.workingMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.bookedMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.percent)) + "%</td>" +
          "<td>" + escapeHtml(hours(row.idleMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.gapMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.openEdgeMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.gapSharePercent)) + "%</td>" +
          "<td>" + escapeHtml(String(row.idleSharePercent)) + "%</td>" +
        "</tr>"
      );
    }).join("");
  }

  function hourRowsHtml(hoursRows) {
    return (hoursRows || []).map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(row.shortLabel || row.label) + "</td>" +
          "<td>" + escapeHtml(hours(row.workingMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.bookedMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.idleMinutes)) + "</td>" +
          "<td>" + escapeHtml(hours(row.gapMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.percent)) + "%</td>" +
          "<td>" + escapeHtml(String(row.gapSharePercent)) + "%</td>" +
        "</tr>"
      );
    }).join("");
  }

  function patternBars(rows, labelFn, valueFn, displayFn) {
    var max = 0;
    (rows || []).forEach(function (row) {
      var value = valueFn(row);
      if (value > max) max = value;
    });
    if (!max) return "";
    return (
      '<div class="ff-rpt-bars ff-rpt-bars-pattern">' +
        (rows || []).map(function (row) {
          var value = valueFn(row);
          var width = Math.round((value / max) * 100);
          return (
            '<div class="ff-rpt-bar-row ff-rpt-bar-row-pattern">' +
              '<span class="ff-rpt-bar-label">' + escapeHtml(labelFn(row)) + "</span>" +
              '<span class="ff-rpt-bar-track"><span class="ff-rpt-bar-fill" style="width:' + width + '%"></span></span>' +
              '<span class="ff-rpt-bar-value">' + escapeHtml(String(displayFn(row))) + "</span>" +
            "</div>"
          );
        }).join("") +
      "</div>"
    );
  }

  function patternsHtml(report) {
    var patterns = report && report.patterns;
    var days = (patterns && patterns.days) || [];
    if (!days.length) return "";
    var weekdays = patterns.weekdays || [];
    var hoursRows = patterns.hours || [];
    var body = "";
    if (patternView === "hours") {
      body =
        patternBars(hoursRows, function (row) {
          return row.shortLabel || row.label;
        }, function (row) {
          return row.gapMinutes || 0;
        }, function (row) {
          return hours(row.gapMinutes);
        }) +
        patternTable(
          ["Hour", "Working hrs", "Booked hrs", "Idle hrs", "Gap hrs", "Utilization", "Gap share"],
          hourRowsHtml(hoursRows),
          "ff-rpt-table-patterns"
        );
    } else {
      var weekdayBars = patternBars(weekdays, function (row) {
        return row.label || weekdayLabel(row.weekday);
      }, function (row) {
        return row.percent || 0;
      }, function (row) {
        return row.percent + "%";
      });
      body =
        weekdayBars +
        patternTable(
          ["Weekday", "Days", "Working hrs", "Booked hrs", "Utilization", "Idle hrs", "Gap hrs", "Gap share"],
          weekdayRowsHtml(weekdays),
          "ff-rpt-table-patterns"
        ) +
        patternTable(
          ["Date", "Weekday", "Working hrs", "Booked hrs", "Utilization", "Idle hrs", "Gap hrs", "Open-edge hrs", "Gap share", "Idle share"],
          dayRowsHtml(days),
          "ff-rpt-table-capacity"
        );
    }
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Capacity patterns</h2>" +
        '<p class="ff-rpt-fine">Shows when provider capacity was most and least utilized. Closed days are omitted. Hours are provider hours, not salon wall-clock hours.</p>' +
        patternHighlights(patterns.summary) +
        patternToggleHtml() +
        body +
      "</section>"
    );
  }

  function serviceDemandHtml(report) {
    var demand = report && report.serviceDemand;
    var services = (demand && demand.services) || [];
    if (!services.length) return "";
    var totals = demand.totals || {};
    var top = demand.highestDemand;
    var rows = services.map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(row.name || "Service") + "</td>" +
          "<td>" + escapeHtml(String(row.appointmentCount || 0) + " / " + String(row.lineCount || 0)) + "</td>" +
          "<td>" + escapeHtml(String(row.clientCount || 0)) + "</td>" +
          "<td>" + escapeHtml(hours(row.bookedMinutes)) + "</td>" +
          "<td>" + escapeHtml(String(row.timeMixPercent)) + "%</td>" +
          "<td>" + escapeHtml(row.bookedServiceValue > 0 ? money(row.bookedServiceValue) : "—") + "</td>" +
          "<td>" + escapeHtml(row.valuePerProviderHour != null ? money(row.valuePerProviderHour) : "—") + "</td>" +
          "<td>" + escapeHtml(String(row.providerCount || 0)) + "</td>" +
          "<td>" + escapeHtml(row.providerCount ? String(row.topProviderSharePercent) + "%" : "—") + "</td>" +
        "</tr>"
      );
    }).join("");
    var quality = totals.unpricedLineCount
      ? '<p class="ff-rpt-fine">Booked service value includes only lines with a price snapshot. ' +
        escapeHtml(String(totals.unpricedLineCount)) +
        " service line" + (totals.unpricedLineCount === 1 ? "" : "s") +
        " had no booked price.</p>"
      : '<p class="ff-rpt-fine">Booked service value is the appointment price snapshot, not collected sales. Service hours count each service line; overlapping lines are not unioned here.</p>';
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Service demand &amp; capacity</h2>" +
        '<p class="ff-rpt-fine">Based on appointment service lines. Booked value is not collected sales. Booked value / provider hr is booked value density, not provider pay.</p>' +
        '<div class="ff-rpt-kpis">' +
          kpi("Distinct services", totals.serviceCount || 0) +
          kpi("Booked service hours", hoursUnit(totals.bookedMinutes || 0)) +
          kpi("Highest-demand service", top && top.name ? top.name : "—", top ? hoursUnit(top.bookedMinutes) : "") +
        "</div>" +
        patternTable(
          ["Service", "Bookings / lines", "Clients", "Booked hours", "Time mix", "Booked value", "Value / provider hr", "Providers", "Top-provider share"],
          rows,
          "ff-rpt-table-demand"
        ) +
        quality +
      "</section>"
    );
  }

  function clientBehaviorHtml(report) {
    var b = report && report.clientBehavior;
    if (!b) return "";
    if (!b.identifiedClientCount && !b.unidentifiedClientAppointmentCount) return "";
    var freq = (b.frequency || []).map(function (row) {
      return barRow(row.label, row.clientCount, b.identifiedClientCount || 1);
    }).join("");
    var quality = b.unidentifiedClientAppointmentCount
      ? '<p class="ff-rpt-fine">' + escapeHtml(String(b.unidentifiedClientAppointmentCount)) +
        " appointment" + (b.unidentifiedClientAppointmentCount === 1 ? "" : "s") +
        " had no client id and are excluded from unique-client counts.</p>"
      : "";
    var spacing = b.averageDaysBetweenVisits != null
      ? kpi("Avg days between visits", b.averageDaysBetweenVisits, "repeat-in-period, this range")
      : "";
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Client behavior</h2>" +
        '<p class="ff-rpt-fine">Shows behavior inside this reporting period, not lifetime retention.</p>' +
        '<div class="ff-rpt-kpis">' +
          kpi("First-visit clients", b.firstVisitClientCount || 0) +
          kpi("Returning clients", b.returningClientCount || 0) +
          kpi("Repeat-in-period clients", b.repeatInPeriodClientCount || 0) +
          kpi("Repeat-in-period appointment share", (b.repeatInPeriodAppointmentShare || 0) + "%") +
          kpi("Multi-service clients", (b.multiServiceClientShare || 0) + "%") +
          kpi("Requested-provider share", (b.requestedProviderShare || 0) + "%", "of assigned lines") +
          spacing +
        "</div>" +
        (freq
          ? '<p class="ff-rpt-fine ff-rpt-behavior-freq">Appointments in this period</p><div class="ff-rpt-bars">' + freq + "</div>"
          : "") +
        quality +
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
        '<p class="ff-rpt-fine">Shows how scheduled provider working time was used during this period. Ranked by the most calendar gap time, then idle. Calendar gaps are holes between visits; open-edge idle is unused time at the start or end of a working window.</p>' +
        body +
      "</section>"
    );
  }

  function gapsHtml(report) {
    var g = report.gaps;
    var cap = report.capacity;
    var estimate = cap.estimatedDollars == null
      ? '<p class="ff-rpt-fine">Estimated unused service capacity is shown only when booked services have both a price and a duration.</p>'
      : '<div class="ff-rpt-estimate">' +
          '<p class="ff-rpt-estimate-label">Estimated unused service capacity</p>' +
          '<p class="ff-rpt-estimate-value">' + escapeHtml(money(cap.estimatedDollars)) + "</p>" +
          '<p class="ff-rpt-fine">Estimate only: average booked service dollars per booked minute, multiplied by calendar gap minutes. Based on booked service value, not a guarantee.</p>' +
        "</div>";
    if (!g.count && cap.estimatedDollars == null) {
      if (!(report.appointments && report.appointments.total) && !(report.utilization && report.utilization.workingMinutes)) {
        return "";
      }
      return (
        '<section class="ff-rpt-panel">' +
          "<h2>Calendar gaps</h2>" +
          '<p class="ff-rpt-fine">A calendar gap is unused working time between two booked visits. Open-edge idle is unused time at the start or end of a shift, not a gap.</p>' +
          '<p class="ff-rpt-empty">No calendar gaps in this period.</p>' +
        "</section>"
      );
    }
    return (
      '<section class="ff-rpt-panel">' +
        "<h2>Calendar gaps</h2>" +
        '<p class="ff-rpt-fine">A calendar gap is unused working time between two booked visits. Open-edge idle is unused time at the start or end of a shift, not a gap.</p>' +
        '<div class="ff-rpt-kpis">' +
          kpi("Gaps", g.count) +
          kpi("Small gap hours", hoursUnit(g.smallMinutes), "30 minutes or less") +
          kpi("Larger gap hours", hoursUnit(g.largerMinutes), "over 30 minutes") +
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
        overviewHtml(result) +
        insightsHtml(result) +
        utilizationHtml(result) +
        patternsHtml(result) +
        serviceDemandHtml(result) +
        clientBehaviorHtml(result) +
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
    var patternBtn = t.closest("[data-ff-intel-pattern]");
    if (patternBtn) {
      ev.preventDefault();
      var nextView = patternBtn.getAttribute("data-ff-intel-pattern") || "days";
      if (nextView !== patternView) {
        patternView = nextView;
        paint();
      }
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
