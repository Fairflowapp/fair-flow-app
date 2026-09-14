/**
 * Phase 1 Week View: one provider across seven salon days.
 * Isolated from Day filters. Reuses Day geometry, availability, cards, blocks.
 */
(function () {
  var PICKER_ID = "ffBookingCalWeekPicker";
  var pickerOpen = false;

  function state() { return window.ffBookingCalState || null; }
  function data() { return window.ffBookingCalData || null; }
  function time() { return window.ffBookingTime || null; }
  function layout() { return window.ffBookingCalLayout || null; }
  function availability() { return window.ffBookingCalAvailability || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function displayName(emp) {
    var dt = data();
    if (dt && typeof dt.displayNameOf === "function") return dt.displayNameOf(emp);
    return String((emp && (emp.displayName || emp.name || emp.firstName)) || "").trim() || "Staff";
  }

  function avatarHtml(emp, className) {
    var name = displayName(emp);
    var initial = name.charAt(0).toUpperCase() || "S";
    var src = String((emp && emp.photoURL) || "").trim();
    var cls = className || "ff-cal-emp-avatar";
    var fallback = '<span class="' + cls + '-fallback">' + escapeHtml(initial) + "</span>";
    if (!src) return '<span class="' + cls + '">' + fallback + "</span>";
    return '<span class="' + cls + '">' +
      '<img src="' + escapeHtml(src) + '" alt="" onerror="this.style.display=\'none\';var n=this.nextElementSibling;if(n)n.removeAttribute(\'hidden\');">' +
      '<span class="' + cls + '-fallback" hidden>' + escapeHtml(initial) + "</span>" +
      "</span>";
  }

  function employeeForDay(providerId, dateKey, locationId) {
    var dt = data();
    var list = dt && typeof dt.loadCalendarEmployees === "function"
      ? dt.loadCalendarEmployees(dateKey, locationId)
      : [];
    var hit = (list || []).find(function (emp) { return emp && emp.id === providerId; });
    if (hit) return hit;
    return { id: providerId, working: [], displayName: "Staff", firstName: "Staff", photoURL: "" };
  }

  function sharedAxis() {
    var st = state();
    var dt = data();
    var loc = st ? st.getLocationId() : "";
    var keys = st && typeof st.getWeekDateKeys === "function" ? st.getWeekDateKeys() : [];
    var startMin = 8 * 60;
    var endMin = 19 * 60;
    if (dt && typeof dt.businessDayFor === "function" && keys.length) {
      startMin = Infinity;
      endMin = 0;
      keys.forEach(function (dateKey) {
        var day = dt.businessDayFor(dateKey, loc);
        if (Number.isFinite(day && day.startMin)) startMin = Math.min(startMin, day.startMin);
        if (Number.isFinite(day && day.endMin)) endMin = Math.max(endMin, day.endMin);
      });
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        startMin = 8 * 60;
        endMin = 19 * 60;
      }
    }
    return {
      startMin: startMin,
      endMin: endMin,
      salonOpen: true,
      salonStartMin: startMin,
      salonEndMin: endMin,
      intervals: [],
      dateKey: keys[0] || "",
      locationId: loc
    };
  }

  function axisForDate(dateKey, shared) {
    var st = state();
    var dt = data();
    var loc = st ? st.getLocationId() : "";
    var day = dt && typeof dt.businessDayFor === "function" ? dt.businessDayFor(dateKey, loc) : null;
    var base = shared || sharedAxis();
    if (dt && typeof dt.axisFromDay === "function" && day) {
      var axis = dt.axisFromDay(day);
      axis.startMin = base.startMin;
      axis.endMin = base.endMin;
      axis.dateKey = dateKey;
      axis.locationId = loc;
      return axis;
    }
    return {
      startMin: base.startMin,
      endMin: base.endMin,
      salonOpen: !!(day && day.isOpen),
      salonStartMin: day && day.salonStartMin,
      salonEndMin: day && day.salonEndMin,
      intervals: day && day.intervals || [],
      source: day && day.source || "",
      note: day && day.note || "",
      dateKey: dateKey,
      locationId: loc
    };
  }

  function rangeHtml(windows, axis, className) {
    var lay = layout();
    if (!lay) return "";
    return (windows || []).map(function (win) {
      var rect = lay.windowToRect(win.startMin, win.endMin, axis.startMin, axis.endMin);
      if (!rect) return "";
      return '<div class="' + className + '" style="top:' + rect.top + "px;height:" + rect.height + 'px"></div>';
    }).join("");
  }

  function columnOverlayHtml(emp, axis) {
    var av = availability();
    var regions = av && typeof av.unavailableForProvider === "function"
      ? av.unavailableForProvider(emp, axis)
      : { closed: [], off: [] };
    return rangeHtml(regions.off, axis, "ff-cal-off") + rangeHtml(regions.closed, axis, "ff-cal-closed");
  }

  function gridLineHtml(marks, axis, className) {
    var lay = layout();
    if (!lay) return "";
    return marks.map(function (min) {
      return '<div class="' + className + '" style="top:' + lay.timeToY(min, axis.startMin) + 'px"></div>';
    }).join("");
  }

  function dayStatusChip(dateKey, locationId) {
    var dt = data();
    var day = dt && typeof dt.businessDayFor === "function" ? dt.businessDayFor(dateKey, locationId) : null;
    var label = dt && typeof dt.dayStatusLabel === "function" ? dt.dayStatusLabel(day) : "";
    if (!label) return "";
    var special = day && day.source === "special_day_hours";
    return '<span class="' + (special ? "ff-cal-special-note" : "ff-cal-closed-note") + '">' +
      escapeHtml(label) + "</span>";
  }

  function nowLineDayKey() {
    var st = state();
    var tm = time();
    if (!st || !tm || !st.isWeek || !st.isWeek()) return "";
    var today = tm.todayDateKey();
    var keys = st.getWeekDateKeys ? st.getWeekDateKeys() : [];
    return keys.indexOf(today) !== -1 ? today : "";
  }

  function nowLineHtml(dateKey, axis) {
    var tm = time();
    var lay = layout();
    if (!tm || !lay) return "";
    if (dateKey !== nowLineDayKey()) return "";
    var nowMin = tm.nowMinutes();
    if (nowMin < axis.startMin || nowMin > axis.endMin) return "";
    return '<div class="ff-cal-now ff-cal-print-hide" data-ff-cal-now data-ff-cal-now-day="' +
      escapeHtml(dateKey) + '" style="top:' + lay.timeToY(nowMin, axis.startMin) + 'px"></div>';
  }

  function pickerRows() {
    var st = state();
    var employees = st ? st.getEmployees() || [] : [];
    return employees.map(function (emp) {
      return '<button type="button" class="ff-cal-filter-row" data-ff-cal-week-provider="' +
        escapeHtml(emp.id) + '">' +
        avatarHtml(emp, "ff-cal-filter-avatar") +
        '<span class="ff-cal-filter-name">' + escapeHtml(displayName(emp)) + "</span>" +
        "</button>";
    }).join("");
  }

  function closePicker() {
    pickerOpen = false;
    var el = typeof document !== "undefined" ? document.getElementById(PICKER_ID) : null;
    if (el) {
      el.setAttribute("hidden", "");
      el.innerHTML = "";
    }
  }

  function openPicker(anchor) {
    if (typeof document === "undefined") return;
    var el = document.getElementById(PICKER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = PICKER_ID;
      el.className = "ff-cal-menu ff-cal-filter-menu";
      el.setAttribute("role", "menu");
      document.body.appendChild(el);
    }
    el.innerHTML = pickerRows() || '<div class="ff-cal-empty">No service providers for this location yet.</div>';
    el.removeAttribute("hidden");
    pickerOpen = true;
    if (anchor && anchor.getBoundingClientRect) {
      var rect = anchor.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = Math.round(rect.left) + "px";
      el.style.top = Math.round(rect.bottom + 6) + "px";
    }
  }

  function chooseProvider(providerId) {
    var st = state();
    if (!st || !providerId) return;
    st.setWeekProviderId(providerId);
    closePicker();
    if (typeof window.ffRefreshBookingCalendar === "function") window.ffRefreshBookingCalendar();
  }

  function providerBarHtml(emp, needsChoice) {
    if (needsChoice) {
      return '<button type="button" class="ff-cal-week-pick" data-ff-cal-act="week-pick">Choose provider</button>';
    }
    return '<button type="button" class="ff-cal-week-provider" data-ff-cal-act="week-pick" title="Change week provider">' +
      avatarHtml(emp) +
      '<span class="ff-cal-week-provider-name">' + escapeHtml(displayName(emp)) + "</span>" +
      '<span class="ff-cal-emp-caret ff-cal-print-hide" aria-hidden="true">▾</span>' +
      "</button>";
  }

  function paint(root) {
    var st = state();
    var tm = time();
    var lay = layout();
    if (!st || !tm || !lay || !root) return sharedAxis();
    var axis = sharedAxis();
    var keys = st.getWeekDateKeys();
    var loc = st.getLocationId();
    var emp = st.getWeekEmployee();
    var needsChoice = !!(st.weekNeedsProvider && st.weekNeedsProvider());
    var height = lay.axisHeight(axis.startMin, axis.endMin);
    var hours = lay.hourMarks(axis.startMin, axis.endMin);
    var halves = lay.halfHourMarks(axis.startMin, axis.endMin);
    var quarters = lay.quarterMarks(axis.startMin, axis.endMin);
    var linesHtml = gridLineHtml(quarters, axis, "ff-cal-quarter-line")
      + gridLineHtml(halves, axis, "ff-cal-half-line")
      + gridLineHtml(hours, axis, "ff-cal-hour-line");
    var rangeLabel = typeof tm.formatWeekRange === "function"
      ? tm.formatWeekRange(st.getWeekAnchorKey())
      : "";
    var timesHtml = hours.map(function (min) {
      return '<div class="ff-cal-hour" style="top:' + lay.timeToY(min, axis.startMin) + 'px">' +
        escapeHtml(tm.formatHourLabel(min)) + "</div>";
    }).join("") + halves.concat(quarters).map(function (min) {
      var label = tm.formatQuarterLabel(min);
      if (!label) return "";
      return '<div class="ff-cal-quarter" style="top:' + lay.timeToY(min, axis.startMin) + 'px">' +
        escapeHtml(label) + "</div>";
    }).join("");

    var namesHtml = keys.map(function (dateKey) {
      var today = dateKey === tm.todayDateKey();
      return '<div class="ff-cal-day-head' + (today ? " is-today" : "") + '" data-ff-cal-day-head="' +
        escapeHtml(dateKey) + '">' +
        '<span class="ff-cal-day-wd">' + escapeHtml(tm.formatWeekdayShort(dateKey)) + "</span>" +
        '<span class="ff-cal-day-num">' + escapeHtml(tm.formatMonthDay(dateKey)) + "</span>" +
        dayStatusChip(dateKey, loc) +
        "</div>";
    }).join("");

    var colsHtml = keys.map(function (dateKey) {
      var dayEmp = emp ? employeeForDay(emp.id, dateKey, loc) : { id: "", working: [] };
      var dayAxis = axisForDate(dateKey, axis);
      return '<div class="ff-cal-col" data-ff-cal-day="' + escapeHtml(dateKey) + '">' +
        (emp ? columnOverlayHtml(dayEmp, dayAxis) : "") +
        '<div class="ff-cal-col-grid" aria-hidden="true">' + linesHtml + "</div>" +
        (emp ? nowLineHtml(dateKey, axis) : "") +
      "</div>";
    }).join("");

    var bodyHtml = needsChoice
      ? '<div class="ff-cal-empty" data-ff-cal-week-empty="1">Choose a provider to see their week.</div>'
      : '<div class="ff-cal-viewport" data-ff-cal-viewport>' +
          '<div class="ff-cal-board" data-ff-cal-board data-ff-cal-week-board="1">' +
            '<div class="ff-cal-corner"></div>' +
            '<div class="ff-cal-head"><div class="ff-cal-emp-head">' + namesHtml + "</div></div>" +
            '<div class="ff-cal-times" style="height:' + height + 'px">' + linesHtml + timesHtml + "</div>" +
            '<div class="ff-cal-surface" data-ff-cal-surface style="height:' + height + 'px">' +
              '<div class="ff-cal-cols">' + colsHtml + "</div>" +
            "</div>" +
          "</div>" +
        "</div>";

    var filterOn = !!(st.isProviderFilterActive && st.isProviderFilterActive());
    root.innerHTML =
      '<div class="ff-cal is-week">' +
        '<div class="ff-cal-toolbar ff-cal-print-hide">' +
          '<div class="ff-cal-toolbar-left">' +
            '<button type="button" class="ff-cal-today" data-ff-cal-act="today">This week</button>' +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="prev" aria-label="Previous week">‹</button>' +
            '<div class="ff-cal-date">' + escapeHtml(rangeLabel) + "</div>" +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="next" aria-label="Next week">›</button>' +
            providerBarHtml(emp, needsChoice) +
          "</div>" +
          '<div class="ff-cal-toolbar-right">' +
            '<button type="button" class="ff-cal-filters' + (filterOn ? " is-on" : "") +
              '" data-ff-cal-act="filters" aria-haspopup="menu" aria-expanded="false">' +
              escapeHtml(window.ffBookingCalFilters && window.ffBookingCalFilters.buttonLabel
                ? window.ffBookingCalFilters.buttonLabel()
                : "Filters") +
            "</button>" +
            '<button type="button" class="ff-cal-print" data-ff-cal-act="print" disabled title="Print Day is available in Day view">Print Day</button>' +
            '<div class="ff-cal-view" role="group" aria-label="Calendar view">' +
              '<button type="button" class="ff-cal-view-btn" data-ff-cal-act="view-day">Day</button>' +
              '<button type="button" class="ff-cal-view-btn is-active" data-ff-cal-act="view-week">Week</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
        bodyHtml +
      "</div>";
    closePicker();
    return axis;
  }

  function updateNowLine() {
    var st = state();
    var tm = time();
    var lay = layout();
    var root = typeof document !== "undefined" ? document.getElementById("ffBookingCalendarRoot") : null;
    if (!st || !tm || !lay || !root || !st.isWeek()) return;
    var today = tm.todayDateKey();
    if (st.getWeekDateKeys().indexOf(today) === -1) {
      root.querySelectorAll("[data-ff-cal-now]").forEach(function (el) { el.remove(); });
      return;
    }
    var axis = sharedAxis();
    var nowMin = tm.nowMinutes();
    var col = root.querySelector('[data-ff-cal-day="' + today + '"]');
    var el = root.querySelector("[data-ff-cal-now]");
    if (!col || nowMin < axis.startMin || nowMin > axis.endMin) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "ff-cal-now ff-cal-print-hide";
      el.setAttribute("data-ff-cal-now", "");
      el.setAttribute("data-ff-cal-now-day", today);
      col.appendChild(el);
    } else if (el.parentNode !== col) {
      col.appendChild(el);
    }
    el.style.top = lay.timeToY(nowMin, axis.startMin) + "px";
  }

  function bindPicker() {
    if (typeof document === "undefined" || document.documentElement.getAttribute("data-ff-cal-week-bound")) return;
    document.documentElement.setAttribute("data-ff-cal-week-bound", "1");
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var row = t.closest("[data-ff-cal-week-provider]");
      if (row) {
        ev.preventDefault();
        chooseProvider(row.getAttribute("data-ff-cal-week-provider"));
        return;
      }
      if (t.closest("#" + PICKER_ID) || t.closest("[data-ff-cal-act='week-pick']")) return;
      closePicker();
    });
  }

  bindPicker();

  window.ffBookingCalWeek = {
    paint: paint,
    sharedAxis: sharedAxis,
    axisForDate: axisForDate,
    nowLineDayKey: nowLineDayKey,
    employeeForDay: employeeForDay,
    updateNowLine: updateNowLine,
    openPicker: openPicker,
    closePicker: closePicker,
    chooseProvider: chooseProvider
  };
})();
