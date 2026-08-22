/**
 * Booking Calendar day-view renderer.
 * State / data / time / layout stay in their modules. One delegated click
 * listener and one resize listener — no per-cell handlers.
 */
(function () {
  var ROOT_ID = "ffBookingCalendarRoot";
  var nowTimer = null;
  var bound = false;
  var resizeBound = false;
  var canvasObserver = null;
  var lastPaintKey = "";
  var lastColW = 0;

  function state() { return window.ffBookingCalState || null; }
  function data() { return window.ffBookingCalData || null; }
  function time() { return window.ffBookingTime || null; }
  function layout() { return window.ffBookingCalLayout || null; }

  function isCalendarVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "calendar") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function syncContext() {
    var st = state();
    var dt = data();
    var tm = time();
    if (!st || !dt || !tm) return null;
    if (!st.getSelectedDateKey()) st.goToday();
    st.setLocationId(dt.currentLocationId());
    var dateKey = st.getSelectedDateKey();
    st.setBusinessDay(dt.businessDayFor(dateKey));
    st.setEmployees(dt.loadCalendarEmployees(dateKey, st.getLocationId()));
    return st;
  }

  function offHtml(windows, axis) {
    var lay = layout();
    var dt = data();
    if (!lay || !dt) return "";
    return dt.unavailableWindows(windows, axis.startMin, axis.endMin).map(function (win) {
      var rect = lay.windowToRect(win.startMin, win.endMin, axis.startMin, axis.endMin);
      if (!rect) return "";
      return '<div class="ff-cal-off" style="top:' + rect.top + "px;height:" + rect.height + 'px"></div>';
    }).join("");
  }

  function gridLineHtml(marks, axis, className) {
    var lay = layout();
    if (!lay) return "";
    return marks.map(function (min) {
      var top = lay.timeToY(min, axis.startMin);
      return '<div class="' + className + '" style="top:' + top + 'px"></div>';
    }).join("");
  }

  function applyCanvasLayout(root) {
    var lay = layout();
    var st = state();
    if (!lay || !st || !root) return;
    var shell = root.querySelector(".ff-cal");
    var board = root.querySelector("[data-ff-cal-board]");
    var vp = root.querySelector("[data-ff-cal-viewport]");
    if (!shell || !board) return;
    lay.applyTokensToElement(shell);
    var n = (st.getEmployees() || []).length;
    var timeW = lay.tokens().timeW;
    var host = vp || root;
    var available = host.clientWidth > 0 ? Math.max(0, host.clientWidth - timeW) : 0;
    var colW = lay.columnWidthFor(available, n);
    var canvasW = lay.canvasWidth(available, n);
    lastColW = colW;
    board.style.setProperty("--ff-cal-col-w", colW + "px");
    board.style.setProperty("--ff-cal-cols-w", canvasW + "px");
    board.style.setProperty("--ff-cal-canvas-w", canvasW + "px");
  }

  function rememberSlot(ev, surface) {
    var lay = layout();
    var st = state();
    if (!lay || !st || !surface || !ev) return;
    var rect = surface.getBoundingClientRect();
    window.ffBookingCalLastSlot = lay.hitTest(
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      {
        employees: st.getEmployees(),
        axis: st.getAxis(),
        dateKey: st.getSelectedDateKey(),
        columnWidth: lastColW
      }
    );
  }

  function watchCanvas(root) {
    var vp = root && root.querySelector("[data-ff-cal-viewport]");
    if (!vp || typeof ResizeObserver === "undefined") return;
    if (canvasObserver) canvasObserver.disconnect();
    canvasObserver = new ResizeObserver(function () {
      applyCanvasLayout(root);
    });
    canvasObserver.observe(vp);
  }

  function paint(root) {
    var st = syncContext();
    var tm = time();
    var lay = layout();
    if (!st || !tm || !lay || !root) return;
    var axis = st.getAxis();
    var employees = st.getEmployees();
    var height = lay.axisHeight(axis.startMin, axis.endMin);
    var hours = lay.hourMarks(axis.startMin, axis.endMin);
    var halves = lay.halfHourMarks(axis.startMin, axis.endMin);
    var quarters = lay.quarterMarks(axis.startMin, axis.endMin);
    var linesHtml = gridLineHtml(quarters, axis, "ff-cal-quarter-line")
      + gridLineHtml(halves, axis, "ff-cal-half-line")
      + gridLineHtml(hours, axis, "ff-cal-hour-line");
    var dateLabel = tm.formatDisplayDate(st.getSelectedDateKey());
    var closed = !axis.salonOpen;

    var timesHtml = hours.map(function (min) {
      var top = lay.timeToY(min, axis.startMin);
      return '<div class="ff-cal-hour" style="top:' + top + 'px">' + escapeHtml(tm.formatHourLabel(min)) + "</div>";
    }).join("") + halves.concat(quarters).map(function (min) {
      var top = lay.timeToY(min, axis.startMin);
      var label = tm.formatQuarterLabel(min);
      if (!label) return "";
      return '<div class="ff-cal-quarter" style="top:' + top + 'px">' + escapeHtml(label) + "</div>";
    }).join("");

    var namesHtml = employees.map(function (emp) {
      return '<div class="ff-cal-emp-name">' + escapeHtml(emp.firstName) + "</div>";
    }).join("");

    var colsHtml = employees.map(function (emp) {
      return '<div class="ff-cal-col" data-ff-cal-emp="' + escapeHtml(emp.id) + '">' +
        offHtml(emp.working, axis) +
      "</div>";
    }).join("");

    var nowHtml = "";
    if (st.isToday()) {
      var nowMin = tm.nowMinutes();
      if (nowMin >= axis.startMin && nowMin <= axis.endMin) {
        nowHtml = '<div class="ff-cal-now" data-ff-cal-now style="top:' +
          lay.timeToY(nowMin, axis.startMin) + 'px"></div>';
      }
    }

    var emptyHtml = !employees.length
      ? '<div class="ff-cal-empty">No service providers for this location yet.</div>'
      : "";

    root.innerHTML =
      '<div class="ff-cal' + (closed ? " is-closed" : "") + '">' +
        '<div class="ff-cal-toolbar">' +
          '<div class="ff-cal-toolbar-left">' +
            '<button type="button" class="ff-cal-today" data-ff-cal-act="today">Today</button>' +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="prev" aria-label="Previous day">‹</button>' +
            '<div class="ff-cal-date">' + escapeHtml(dateLabel) + "</div>" +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="next" aria-label="Next day">›</button>' +
            (closed ? '<span class="ff-cal-closed-note">Salon closed</span>' : "") +
          "</div>" +
          '<div class="ff-cal-toolbar-right">' +
            '<button type="button" class="ff-cal-filters" disabled title="Coming later">Filters</button>' +
            '<div class="ff-cal-view" role="group" aria-label="Calendar view">' +
              '<button type="button" class="ff-cal-view-btn is-active">Day</button>' +
              '<button type="button" class="ff-cal-view-btn" disabled title="Week view coming later">Week</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
        (emptyHtml ||
        '<div class="ff-cal-viewport" data-ff-cal-viewport>' +
          '<div class="ff-cal-board" data-ff-cal-board>' +
            '<div class="ff-cal-corner"></div>' +
            '<div class="ff-cal-head">' +
              '<div class="ff-cal-emp-head">' + namesHtml + "</div>" +
            "</div>" +
            '<div class="ff-cal-times" style="height:' + height + 'px">' + linesHtml + timesHtml + "</div>" +
            '<div class="ff-cal-surface" data-ff-cal-surface style="height:' + height + 'px">' +
              '<div class="ff-cal-gridlines" aria-hidden="true">' + linesHtml + "</div>" +
              '<div class="ff-cal-cols">' + colsHtml + "</div>" +
              nowHtml +
            "</div>" +
          "</div>" +
        "</div>") +
      "</div>";

    var shell = root.querySelector(".ff-cal");
    if (shell) lay.applyTokensToElement(shell);
    applyCanvasLayout(root);
    watchCanvas(root);
    lastPaintKey = st.getSelectedDateKey() + "|" + st.getLocationId() + "|" + employees.length;
  }

  function updateNowLine() {
    if (!isCalendarVisible()) return;
    var st = state();
    var tm = time();
    var lay = layout();
    var root = document.getElementById(ROOT_ID);
    if (!st || !tm || !lay || !root || !st.isToday()) return;
    var axis = st.getAxis();
    var nowMin = tm.nowMinutes();
    var el = root.querySelector("[data-ff-cal-now]");
    if (nowMin < axis.startMin || nowMin > axis.endMin) {
      if (el) el.remove();
      return;
    }
    var top = lay.timeToY(nowMin, axis.startMin);
    if (!el) {
      var surface = root.querySelector("[data-ff-cal-surface]");
      if (!surface) return;
      el = document.createElement("div");
      el.className = "ff-cal-now";
      el.setAttribute("data-ff-cal-now", "");
      surface.appendChild(el);
    }
    el.style.top = top + "px";
  }

  function startNowTimer() {
    if (nowTimer) return;
    nowTimer = setInterval(updateNowLine, 30000);
  }

  function restoreScroll(root, left, top) {
    var vp = root.querySelector("[data-ff-cal-viewport]");
    if (!vp) return;
    vp.scrollLeft = left;
    vp.scrollTop = top;
  }

  function readScroll(root) {
    var vp = root.querySelector("[data-ff-cal-viewport]");
    return vp ? { left: vp.scrollLeft, top: vp.scrollTop } : { left: 0, top: 0 };
  }

  function render(opts) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var keepScroll = opts && opts.keepScroll;
    var scroll = keepScroll ? readScroll(root) : { left: 0, top: 0 };
    paint(root);
    if (keepScroll) restoreScroll(root, scroll.left, scroll.top);
    startNowTimer();
  }

  function onAction(act) {
    var st = state();
    if (!st) return;
    if (act === "today") st.goToday();
    else if (act === "prev") st.shiftDay(-1);
    else if (act === "next") st.shiftDay(1);
    else return;
    render({ keepScroll: false });
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var root = document.getElementById(ROOT_ID);
      if (!root || !root.contains(t)) return;
      var btn = t.closest("[data-ff-cal-act]");
      if (btn) {
        ev.preventDefault();
        onAction(btn.getAttribute("data-ff-cal-act"));
        return;
      }
      rememberSlot(ev, t.closest("[data-ff-cal-surface]"));
    });
    document.addEventListener("ff-staff-cloud-updated", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-active-location-changed", function () {
      if (isCalendarVisible()) render({ keepScroll: false });
    });
    document.addEventListener("ff-locations-updated", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener("resize", function () {
        var root = document.getElementById(ROOT_ID);
        if (root && isCalendarVisible()) applyCanvasLayout(root);
      });
    }
  }

  function refresh() {
    bind();
    if (!isCalendarVisible()) return;
    render({ keepScroll: true });
  }

  window.ffRefreshBookingCalendar = refresh;
  window.ffBookingCalendarPaintKey = function () { return lastPaintKey; };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
