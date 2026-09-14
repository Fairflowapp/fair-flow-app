/**
 * Cancellations report. Appointments scheduled in the selected range
 * that were cancelled. Not sales, rebooking, or recovered capacity.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "cancellations";
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
  var loadGen = 0;

  function compute() { return window.ffBookingReportsCompute || null; }
  function math() { return window.ffBookingReportsCancellationsCompute || null; }
  function repo() { return window.ffBookingAppointments || null; }
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

  function currentRange() {
    var api = compute();
    var today = todayKey();
    return api && typeof api.rangeForPreset === "function"
      ? api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
  }

  function formatDay(dateKey) {
    var api = compute();
    return api && typeof api.shortDate === "function" ? api.shortDate(dateKey) : dateKey;
  }

  function periodText() {
    var api = compute();
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

  function zoneOf(locationId) {
    var tm = time();
    if (tm && typeof tm.getTimeZone === "function") {
      try { return tm.getTimeZone(locationId) || "America/New_York"; } catch (_) {}
    }
    return "America/New_York";
  }

  function toDate(value) {
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.toDate === "function") return model.toDate(value);
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatWhen(value, locationId) {
    var date = toDate(value);
    if (!date) return "—";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: zoneOf(locationId),
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
    } catch (_) {
      return formatDay(date.toISOString().slice(0, 10));
    }
  }

  function formatNotice(minutes) {
    if (minutes == null || !Number.isFinite(Number(minutes))) return "—";
    var n = Number(minutes);
    var abs = Math.abs(n);
    var suffix = n < 0 ? " after start" : "";
    if (abs < 60) return Math.round(abs) + " min" + suffix;
    var hours = Math.round((abs / 60) * 10) / 10;
    return hours + " hr" + suffix;
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

  function locPopHtml() {
    var ids = selectedLocationIds();
    var rows = locations().map(function (row) {
      var on = ids.indexOf(row.id) !== -1;
      return (
        '<label class="ff-rpt-check" data-ff-cancel-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-cancel-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-cancel-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-cancel-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-cancel-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-cancel-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-cancel-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-cancel-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-cancel-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-cancel-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-cancel-generate' +
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
        '<table class="ff-rpt-table ff-rpt-table-compact ff-rpt-table-cancel' +
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
    var cancelMath = math();
    var dayCols = [
      { label: "Date", value: function (row) { return formatDay(row.dateKey); } },
      { label: "Cancelled", value: function (row) { return String(row.cancelled); } },
      { label: "Scheduled", value: function (row) { return String(row.scheduled); } },
      { label: "Cancelled hours", value: function (row) { return hoursText(row.hours); } },
      { label: "Cancellation rate", value: function (row) { return mixText(row.rate); } }
    ];
    var weekdayCols = [
      { label: "Weekday", value: function (row) { return row.label; } },
      { label: "Dates represented", value: function (row) { return String(row.dateCount); } },
      { label: "Cancelled", value: function (row) { return String(row.cancelled); } },
      { label: "Cancelled hours", value: function (row) { return hoursText(row.hours); } },
      { label: "Cancellation rate", value: function (row) { return mixText(row.rate); } }
    ];
    var providerCols = [
      { label: "Provider", value: function (row) { return row.name; } },
      { label: "Cancelled lines", value: function (row) { return String(row.lineCount); } },
      { label: "Cancelled hours", value: function (row) { return hoursText(row.hours); } },
      { label: "Share", value: function (row) { return mixText(row.mix); } },
      { label: "Average notice", value: function (row) { return formatNotice(row.averageNoticeMinutes); } }
    ];
    var serviceCols = [
      { label: "Service", value: function (row) { return row.name; } },
      { label: "Cancelled lines", value: function (row) { return String(row.lineCount); } },
      { label: "Cancelled hours", value: function (row) { return hoursText(row.hours); } },
      { label: "Share", value: function (row) { return mixText(row.mix); } }
    ];
    var detailCols = [
      { label: "Appointment", value: function (row) { return formatWhen(row.startAt, row.locationId); } },
      { label: "Cancelled on", value: function (row) { return formatWhen(row.cancelledAt, row.locationId); } },
      { label: "Client", value: function (row) { return row.clientName; } },
      { label: "Provider(s)", value: function (row) { return (row.providers || []).join(", ") || "—"; } },
      { label: "Service(s)", value: function (row) { return (row.services || []).join(", ") || "—"; } },
      { label: "Cancelled hours", value: function (row) { return hoursText(row.hours); } },
      { label: "Notice", value: function (row) { return formatNotice(row.noticeMinutes); } },
      { label: "Reason", value: function (row) { return row.reason || "—"; } },
      { label: "Later appointment", value: function (row) { return row.laterAppointmentInRange ? "In loaded range" : "—"; } }
    ];
    var emptyNote = !totals.cancelled
      ? '<p class="ff-rpt-fine">' + escapeHtml((cancelMath && cancelMath.EMPTY_MESSAGE) || "No cancelled appointments in this period.") + "</p>"
      : "";
    var insights = ((summary && summary.insights) || []).map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("");
    var repeatNote = totals.repeatClients
      ? '<p class="ff-rpt-fine">' + escapeHtml(String(totals.repeatClients)) +
        " clients had multiple cancellations in this period.</p>"
      : "";
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-intel-head">' +
          "<h1>Cancellations</h1>" +
          "<p>Appointments scheduled in this period that were cancelled. Cancellation rate uses all appointments scheduled in the period.</p>" +
        "</div>" +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
          '<p class="ff-rpt-fine">Cancelled appointments as a share of all appointments scheduled in this period. Hours are cancelled booked provider time, not a revenue or capacity figure.</p>' +
        "</div>" +
        emptyNote +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Cancelled appointments", String(totals.cancelled || 0)) +
          kpi("Cancellation rate", mixText(totals.rate || 0), totals.scheduled ? (totals.scheduled + " scheduled") : "No scheduled appointments") +
          kpi("Cancelled provider hours", hoursText(totals.hours || 0)) +
          kpi("Average notice", formatNotice(totals.averageNoticeMinutes), totals.noticeSample ? "From cancellations with timestamps" : "No cancellation timestamps") +
          kpi("Cancelled within 24h", String(totals.within24h || 0)) +
          kpi("Same-day cancellations", String(totals.sameDay || 0), "Salon-local appointment date") +
        "</div>" +
        repeatNote +
        (insights
          ? '<section class="ff-rpt-panel ff-rpt-insights"><h2>Period notes</h2><ul>' + insights + "</ul></section>"
          : "") +
        '<section class="ff-rpt-panel">' +
          "<h2>By appointment date</h2>" +
          table(dayCols, summary.days || [], null, "ff-rpt-table-cancel-day") +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>By weekday</h2>" +
          table(weekdayCols, summary.weekdays || [], null, "ff-rpt-table-cancel-weekday") +
          '<p class="ff-rpt-fine">Dates represented are calendar occurrences of that weekday in the selected range. Rate uses appointments scheduled on those dates.</p>' +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>By provider</h2>" +
          ((summary.providers || []).length
            ? table(providerCols, summary.providers)
            : '<p class="ff-rpt-fine">No cancelled service lines with a provider id.</p>') +
          '<p class="ff-rpt-fine">Each provider receives only their own cancelled service-line time. Missing provider ids are not assigned to a person.</p>' +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>By service</h2>" +
          ((summary.services || []).length
            ? table(serviceCols, summary.services)
            : '<p class="ff-rpt-fine">No cancelled service lines.</p>') +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>Cancelled appointments</h2>" +
          ((summary.rows || []).length
            ? table(detailCols, summary.rows, null, "ff-rpt-table-cancel-detail")
            : "") +
          '<p class="ff-rpt-fine">Later appointment means another non-cancelled visit for the same client already in this loaded range. It is not a rebook or a replacement appointment.</p>' +
        "</section>" +
      "</div>"
    );
  }

  function resultHtml() {
    if (status === "idle") return '<p class="ff-rpt-empty">Choose locations and a date, then Generate.</p>';
    if (status === "loading") return '<p class="ff-rpt-empty">Reading appointments…</p>';
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

  async function loadAppointments(ids, fromKey, toKey) {
    var api = repo();
    var cancelMath = math();
    if (!api) throw new Error("Appointments are not loaded.");
    if (typeof api.getAppointmentsForDate !== "function") {
      throw new Error("Appointment range reads are not available.");
    }
    var keys = cancelMath && typeof cancelMath.dateKeysBetween === "function"
      ? cancelMath.dateKeysBetween(fromKey, toKey)
      : [fromKey];
    var seen = {};
    var rows = [];
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
          var id = row && String(row.appointmentId || row.id || "").trim();
          if (!id || seen[id]) return;
          seen[id] = true;
          rows.push(row);
        });
      });
    }
    return rows;
  }

  async function generate() {
    var dates = compute();
    var cancelMath = math();
    var ids = selectedLocationIds();
    var range = dates && typeof dates.rangeForPreset === "function"
      ? dates.rangeForPreset(filters.date, todayKey(), filters.customFrom, filters.customTo)
      : { fromKey: todayKey(), toKey: todayKey() };
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
    var appointments = [];
    try {
      appointments = await loadAppointments(ids, range.fromKey, range.toKey);
    } catch (err) {
      finish(requestId, "error", (rangeApi() && typeof rangeApi().userSafeError === "function")
        ? rangeApi().userSafeError(err && err.message)
        : "This report could not load.", null);
      return;
    }
    var summary = cancelMath && typeof cancelMath.summarizeCancellations === "function"
      ? cancelMath.summarizeCancellations(appointments, {
        fromKey: range.fromKey,
        toKey: range.toKey,
        locationIds: ids
      })
      : { totals: { scheduled: 0, cancelled: 0 }, days: [], rows: [], insights: [] };
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
    var locRow = t.closest("[data-ff-cancel-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-cancel-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-cancel-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-cancel-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-cancel-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-cancel-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-cancel-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-cancel-date") || "today";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-cancel-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-cancel-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-cancel-custom");
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
    if (!host.getAttribute("data-ff-rpt-cancel-bound")) {
      host.setAttribute("data-ff-rpt-cancel-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsCancellations = {
    paint: paint
  };
})();
