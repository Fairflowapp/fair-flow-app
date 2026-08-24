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
  function availability() { return window.ffBookingCalAvailability || null; }
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
    st.setBusinessDay(dt.businessDayFor(dateKey, st.getLocationId()));
    st.setEmployees(dt.loadCalendarEmployees(dateKey, st.getLocationId()));
    if (window.ffBookingAvailabilityStore && typeof window.ffBookingAvailabilityStore.ensureLoaded === "function") {
      window.ffBookingAvailabilityStore.ensureLoaded();
    }
    return st;
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
      : null;
    if (!regions) {
      var dt = data();
      if (!dt) return "";
      regions = {
        closed: dt.salonClosedWindows(
          axis.startMin, axis.endMin, axis.salonStartMin, axis.salonEndMin, axis.salonOpen, axis.intervals
        ),
        off: dt.employeeOffWindows(emp.working, axis.salonStartMin, axis.salonEndMin, axis.salonOpen)
      };
    }
    return rangeHtml(regions.off, axis, "ff-cal-off") + rangeHtml(regions.closed, axis, "ff-cal-closed");
  }

  function providerAvatarHtml(emp) {
    var firstName = String(emp.firstName || "").trim() || "Staff";
    var initial = firstName.charAt(0).toUpperCase();
    var src = "";
    if (typeof window.ffGetAvatarUrlForUser === "function") {
      try {
        src = String(window.ffGetAvatarUrlForUser({
          staffId: emp.id,
          name: emp.name || firstName,
          photoURL: emp.photoURL,
          avatarUrl: emp.photoURL
        }) || "").trim();
      } catch (_) {
        src = "";
      }
    }
    if (!src) src = String(emp.photoURL || "").trim();
    var fallback = '<span class="ff-cal-emp-avatar-fallback">' + escapeHtml(initial) + "</span>";
    if (!src) return '<span class="ff-cal-emp-avatar">' + fallback + "</span>";
    return '<span class="ff-cal-emp-avatar">' +
      '<img src="' + escapeHtml(src) + '" alt="" onerror="this.style.display=\'none\';var n=this.nextElementSibling;if(n)n.removeAttribute(\'hidden\');">' +
      '<span class="ff-cal-emp-avatar-fallback" hidden>' + escapeHtml(initial) + "</span>" +
      "</span>";
  }

  function providerHeaderHtml(emp) {
    var firstName = String(emp.firstName || "").trim() || "Staff";
    return '<button type="button" class="ff-cal-emp-btn" data-ff-cal-provider="' +
      escapeHtml(emp.id) + '" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="ff-cal-emp-ctrl">' +
        providerAvatarHtml(emp) +
        '<span class="ff-cal-emp-label">' + escapeHtml(firstName) + "</span>" +
        '<span class="ff-cal-emp-caret" aria-hidden="true">▾</span>' +
      "</span>" +
      "</button>";
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
    var n = ((st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees() || []).length;
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

  function columnWidth(surface) {
    if (lastColW > 0) return lastColW;
    var board = surface && surface.closest ? surface.closest("[data-ff-cal-board]") : null;
    var raw = board ? getComputedStyle(board).getPropertyValue("--ff-cal-col-w") : "";
    var n = parseFloat(raw);
    return n > 0 ? n : lastColW;
  }

  function rememberSlot(ev, surface) {
    var lay = layout();
    var st = state();
    if (!lay || !st || !surface || !ev) return null;
    var rect = surface.getBoundingClientRect();
    var employees = (st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees();
    var slot = lay.hitTest(
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      {
        employees: employees,
        axis: st.getAxis(),
        dateKey: st.getSelectedDateKey(),
        columnWidth: columnWidth(surface)
      }
    );
    window.ffBookingCalLastSlot = slot;
    return slot ? { slot: slot, employees: employees, axis: st.getAxis(), locationId: st.getLocationId() } : null;
  }

  function slotIsOpen(emp, axis, minutes) {
    var av = availability();
    if (!av) return false;
    if (typeof av.reasonAt === "function") return av.reasonAt(emp, axis, minutes) === "available";
    return typeof av.isBookableAt === "function" && av.isBookableAt(emp, axis, minutes);
  }

  function openAppointmentFromHit(hit) {
    if (!isCalendarVisible()) return;
    if (!hit || !hit.slot || !window.ffBookingAppointmentDrawer) return;
    var emp = (hit.employees || []).find(function (row) {
      return row && row.id === hit.slot.providerId;
    });
    if (!slotIsOpen(emp, hit.axis, hit.slot.startMin)) return;
    if (window.ffBookingCalDraft) {
      window.ffBookingCalDraft.set({
        providerId: hit.slot.providerId,
        dateKey: hit.slot.dateKey,
        startMin: hit.slot.startMin,
        durationMinutes: 30
      });
    }
    window.ffBookingAppointmentDrawer.open({
      providerId: hit.slot.providerId,
      dateKey: hit.slot.dateKey,
      startMin: hit.slot.startMin,
      locationId: hit.locationId
    });
  }

  function bindViewportScroll(root) {
    var vp = root && root.querySelector("[data-ff-cal-viewport]");
    if (!vp || vp.getAttribute("data-ff-cal-scroll-bound")) return;
    vp.setAttribute("data-ff-cal-scroll-bound", "1");
    vp.addEventListener("scroll", function () {
      if (window.ffBookingCalMenu) window.ffBookingCalMenu.close();
    }, { passive: true });
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
    var employees = (st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees();
    var focusedId = st.getFocusProviderId ? st.getFocusProviderId() : "";
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
      return providerHeaderHtml(emp);
    }).join("");

    var colsHtml = employees.map(function (emp) {
      return '<div class="ff-cal-col" data-ff-cal-emp="' + escapeHtml(emp.id) + '">' +
        columnOverlayHtml(emp, axis) +
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
            (focusedId ? '<button type="button" class="ff-cal-clear-focus" data-ff-cal-act="clear-focus">All providers</button>' : "") +
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
    bindViewportScroll(root);
    if (window.ffBookingCalMenu && typeof window.ffBookingCalMenu.close === "function") {
      window.ffBookingCalMenu.close();
    }
    lastPaintKey = st.getSelectedDateKey() + "|" + st.getLocationId() + "|" + employees.length + "|" + focusedId;
    if (window.ffBookingCalCardRender) window.ffBookingCalCardRender.paint(root);
    if (window.ffBookingCalDraft) window.ffBookingCalDraft.sync(root);
  }

  async function syncAppointmentCards() {
    var root = document.getElementById(ROOT_ID);
    var st = state();
    if (!root || !st || !window.ffBookingCalAppointments) return;
    await window.ffBookingCalAppointments.loadForView(st.getSelectedDateKey(), st.getLocationId());
    if (window.ffBookingCalCardRender) window.ffBookingCalCardRender.paint(root);
    if (window.ffBookingCalDraft) window.ffBookingCalDraft.sync(root);
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

  function initialScrollTop(axis) {
    var lay = layout();
    if (!lay || !axis) return 0;
    var target = Math.max(Number(axis.startMin) || 0, Number(axis.salonStartMin || axis.startMin) - 60);
    var top = lay.timeToY(target, axis.startMin) - (lay.tokens().axisPadTop || 0);
    return top > 0 ? top : 0;
  }

  function render(opts) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var keepScroll = opts && opts.keepScroll;
    var scroll = keepScroll ? readScroll(root) : { left: 0, top: 0 };
    paint(root);
    var st = state();
    if (keepScroll) restoreScroll(root, scroll.left, scroll.top);
    else restoreScroll(root, 0, initialScrollTop(st && st.getAxis ? st.getAxis() : null));
    startNowTimer();
    syncAppointmentCards();
  }

  function onAction(act) {
    var st = state();
    if (!st) return;
    if (act === "today") st.goToday();
    else if (act === "prev") st.shiftDay(-1);
    else if (act === "next") st.shiftDay(1);
    else if (act === "clear-focus") st.clearFocusProvider();
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
      if (t.closest("[data-ff-cal-hold]")) {
        ev.preventDefault();
        return;
      }
      var card = t.closest("[data-ff-cal-card]");
      if (card) {
        ev.preventDefault();
        if (window.ffBookingAppointmentDetails && typeof window.ffBookingAppointmentDetails.open === "function") {
          window.ffBookingAppointmentDetails.open({
            appointmentId: card.getAttribute("data-ff-cal-card"),
            lineId: card.getAttribute("data-ff-cal-line")
          });
        }
        return;
      }
      var st = state();
      var btn = t.closest("[data-ff-cal-act]");
      if (btn) {
        ev.preventDefault();
        onAction(btn.getAttribute("data-ff-cal-act"));
        return;
      }
      var providerBtn = t.closest("[data-ff-cal-provider]");
      if (providerBtn && window.ffBookingCalMenu) {
        ev.preventDefault();
        window.ffBookingCalMenu.open(providerBtn, {
          providerId: providerBtn.getAttribute("data-ff-cal-provider"),
          firstName: (st && st.getVisibleEmployees ? st.getVisibleEmployees() : []).reduce(function (name, emp) {
            return emp.id === providerBtn.getAttribute("data-ff-cal-provider") ? emp.firstName : name;
          }, ""),
          dateKey: st ? st.getSelectedDateKey() : "",
          locationId: st ? st.getLocationId() : "",
          focusProviderId: st && st.getFocusProviderId ? st.getFocusProviderId() : ""
        });
        return;
      }
      openAppointmentFromHit(rememberSlot(ev, t.closest("[data-ff-cal-surface]")));
    });
    document.addEventListener("ff-staff-cloud-updated", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-schedule-settings-changed", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-booking-availability-changed", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-active-location-changed", function () {
      if (isCalendarVisible()) render({ keepScroll: false });
    });
    document.addEventListener("ff-locations-updated", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-booking-appointment-created", function () {
      if (isCalendarVisible()) syncAppointmentCards();
    });
    document.addEventListener("ff-booking-appointment-updated", function () {
      if (isCalendarVisible()) syncAppointmentCards();
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
