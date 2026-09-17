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

  function providerDisplayName(emp) {
    var dt = data();
    if (dt && typeof dt.displayNameOf === "function") return dt.displayNameOf(emp);
    return String((emp && (emp.displayName || emp.name || emp.firstName)) || "").trim() || "Staff";
  }

  function providerAvatarHtml(emp) {
    var displayName = providerDisplayName(emp);
    var initial = displayName.charAt(0).toUpperCase() || "S";
    var src = "";
    if (typeof window.ffGetAvatarUrlForUser === "function") {
      try {
        src = String(window.ffGetAvatarUrlForUser({
          staffId: emp.id,
          name: displayName,
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
    var displayName = providerDisplayName(emp);
    return '<button type="button" class="ff-cal-emp-btn" data-ff-cal-provider="' +
      escapeHtml(emp.id) + '" aria-haspopup="menu" aria-expanded="false" title="' +
      escapeHtml(displayName) + '">' +
      '<span class="ff-cal-emp-ctrl">' +
        providerAvatarHtml(emp) +
        '<span class="ff-cal-emp-label">' + escapeHtml(displayName) + "</span>" +
        '<span class="ff-cal-emp-caret ff-cal-print-hide" aria-hidden="true">▾</span>' +
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
    if (st.isWeek && st.isWeek()) {
      var weekH = window.ffBookingCalWeek && typeof window.ffBookingCalWeek.headerHeight === "function"
        ? window.ffBookingCalWeek.headerHeight()
        : 68;
      shell.style.setProperty("--ff-cal-header-h", weekH + "px");
    }
    var n = st.isWeek && st.isWeek()
      ? 7
      : ((st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees() || []).length;
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

  function rememberWeekSlot(ev, surface) {
    var st = state();
    var week = window.ffBookingCalWeek;
    if (!st || !week || !surface || !ev) return null;
    if (typeof week.hitTestFromPoint !== "function") return null;
    var rect = surface.getBoundingClientRect();
    var hit = week.hitTestFromPoint(
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      columnWidth(surface)
    );
    window.ffBookingCalLastSlot = hit && hit.slot ? hit.slot : null;
    return hit;
  }

  function slotIsOpen(emp, axis, minutes) {
    var av = availability();
    if (!av) return false;
    if (typeof av.isBookableAt === "function") return av.isBookableAt(emp, axis, minutes);
    return typeof av.reasonAt === "function" && av.reasonAt(emp, axis, minutes) === "available";
  }

  function toastUnavailable(message) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: "error", durationMs: 3200 });
    }
  }

  function blockedCreate(hit, emp) {
    var api = window.ffBookingCalDrop;
    if (!api || !hit || !hit.slot) return null;
    var inspect = typeof api.inspectCreate === "function" ? api.inspectCreate : api.inspect;
    if (typeof inspect !== "function") return null;
    var result = inspect({
      providerId: hit.slot.providerId,
      startMin: hit.slot.startMin,
      durationMinutes: 30,
      axis: hit.axis,
      employee: emp
    });
    return result && result.ok === false ? result : null;
  }

  function dayStatusHtml(st) {
    var dt = data();
    var day = st && typeof st.getBusinessHours === "function" ? st.getBusinessHours() : null;
    var label = dt && typeof dt.dayStatusLabel === "function"
      ? dt.dayStatusLabel(day)
      : (!st.getAxis().salonOpen ? "Salon closed" : "");
    if (!label) return "";
    var special = day && day.source === "special_day_hours";
    return '<span class="' + (special ? "ff-cal-special-note" : "ff-cal-closed-note") + '">' +
      escapeHtml(label) + "</span>";
  }

  function composerHasUnsavedWork() {
    var drawer = window.ffBookingAppointmentDrawer;
    return !!(drawer && typeof drawer.hasUnsavedWork === "function" && drawer.hasUnsavedWork());
  }

  function openAppointmentFromHit(hit) {
    if (!isCalendarVisible()) return;
    if (!hit || !hit.slot || !window.ffBookingAppointmentDrawer) return;
    if (composerHasUnsavedWork()) return;
    var emp = (hit.employees || []).find(function (row) {
      return row && row.id === hit.slot.providerId;
    });
    var blocked = blockedCreate(hit, emp);
    if (blocked) {
      toastUnavailable(blocked.message || "That time is not available.");
      return;
    }
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

  function offerSlotCreate(hit, ev) {
    if (!isCalendarVisible()) return;
    if (!hit || !hit.slot) return;
    if (composerHasUnsavedWork()) return;
    var emp = (hit.employees || []).find(function (row) {
      return row && row.id === hit.slot.providerId;
    });
    var blocked = blockedCreate(hit, emp);
    if (blocked) {
      toastUnavailable(blocked.message || "That time is not available.");
      return;
    }
    if (!slotIsOpen(emp, hit.axis, hit.slot.startMin)) return;
    var ui = window.ffBookingCalBlockUi;
    if (ui && typeof ui.openChooser === "function") {
      ui.openChooser(hit, ev);
      return;
    }
    openAppointmentFromHit(hit);
  }

  function openBlockFromEl(el) {
    var ui = window.ffBookingCalBlockUi;
    var id = el && el.getAttribute ? el.getAttribute("data-ff-cal-block") : "";
    if (ui && typeof ui.openEdit === "function" && id) ui.openEdit(id);
  }

  function bindViewportScroll(root) {
    var vp = root && root.querySelector("[data-ff-cal-viewport]");
    if (!vp || vp.getAttribute("data-ff-cal-scroll-bound")) return;
    vp.setAttribute("data-ff-cal-scroll-bound", "1");
    vp.addEventListener("scroll", function () {
      if (window.ffBookingCalMenu) window.ffBookingCalMenu.close();
      if (window.ffBookingCalFilters) window.ffBookingCalFilters.close();
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
    if (st.isWeek && st.isWeek() && window.ffBookingCalWeek && typeof window.ffBookingCalWeek.paint === "function") {
      window.ffBookingCalWeek.paint(root);
      var shellWeek = root.querySelector(".ff-cal");
      if (shellWeek) lay.applyTokensToElement(shellWeek);
      applyCanvasLayout(root);
      watchCanvas(root);
      bindViewportScroll(root);
      if (window.ffBookingCalMenu && typeof window.ffBookingCalMenu.close === "function") {
        window.ffBookingCalMenu.close();
      }
      if (window.ffBookingCalFilters && typeof window.ffBookingCalFilters.close === "function") {
        window.ffBookingCalFilters.close();
      }
      lastPaintKey = "week|" + st.getWeekStartKey() + "|" + st.getLocationId() + "|" +
        (st.getWeekProviderId ? st.getWeekProviderId() : "") + "|" +
        (st.getVisibleProviderIds ? st.getVisibleProviderIds().join(",") : "");
      paintOverlays(root);
      return;
    }
    var axis = st.getAxis();
    var employees = (st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees();
    var filterOn = !!(st.isProviderFilterActive && st.isProviderFilterActive());
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
        '<div class="ff-cal-col-grid" aria-hidden="true">' + linesHtml + "</div>" +
      "</div>";
    }).join("");

    var nowHtml = "";
    if (st.isToday()) {
      var nowMin = tm.nowMinutes();
      if (nowMin >= axis.startMin && nowMin <= axis.endMin) {
        nowHtml = '<div class="ff-cal-now ff-cal-print-hide" data-ff-cal-now style="top:' +
          lay.timeToY(nowMin, axis.startMin) + 'px"></div>';
      }
    }

    var emptyHtml = !employees.length
      ? '<div class="ff-cal-empty">No service providers for this location yet.</div>'
      : "";

    root.innerHTML =
      '<div class="ff-cal' + (closed ? " is-closed" : "") + '">' +
        '<div class="ff-cal-toolbar ff-cal-print-hide">' +
          '<div class="ff-cal-toolbar-left">' +
            '<button type="button" class="ff-cal-today" data-ff-cal-act="today">Today</button>' +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="prev" aria-label="Previous day">‹</button>' +
            '<div class="ff-cal-date">' + escapeHtml(dateLabel) + "</div>" +
            '<button type="button" class="ff-cal-nav" data-ff-cal-act="next" aria-label="Next day">›</button>' +
            dayStatusHtml(st) +
            (filterOn ? '<button type="button" class="ff-cal-clear-focus" data-ff-cal-act="clear-focus">All providers</button>' : "") +
          "</div>" +
          '<div class="ff-cal-toolbar-right">' +
            '<button type="button" class="ff-cal-filters' + (filterOn ? " is-on" : "") +
              '" data-ff-cal-act="filters" aria-haspopup="menu" aria-expanded="false">' +
              escapeHtml(window.ffBookingCalFilters && window.ffBookingCalFilters.buttonLabel
                ? window.ffBookingCalFilters.buttonLabel()
                : "Filters") +
            "</button>" +
            '<button type="button" class="ff-cal-print" data-ff-cal-act="print">Print Day</button>' +
            '<div class="ff-cal-view" role="group" aria-label="Calendar view">' +
              '<button type="button" class="ff-cal-view-btn is-active" data-ff-cal-act="view-day">Day</button>' +
              '<button type="button" class="ff-cal-view-btn" data-ff-cal-act="view-week">Week</button>' +
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
    if (window.ffBookingCalFilters && typeof window.ffBookingCalFilters.close === "function") {
      window.ffBookingCalFilters.close();
    }
    lastPaintKey = st.getSelectedDateKey() + "|" + st.getLocationId() + "|" + employees.length + "|" +
      (st.getVisibleProviderIds ? st.getVisibleProviderIds().join(",") : "");
    paintOverlays(root);
  }

  function paintOverlays(root) {
    try {
      if (window.ffBookingCalBlocks && typeof window.ffBookingCalBlocks.paint === "function") {
        window.ffBookingCalBlocks.paint(root);
      }
    } catch (_) {}
    try {
      if (window.ffBookingCalCardRender) window.ffBookingCalCardRender.paint(root);
    } catch (_) {}
    try {
      if (window.ffBookingCalDraft) window.ffBookingCalDraft.sync(root);
    } catch (_) {}
    try {
      if (window.ffBookingAppointmentDrawer && typeof window.ffBookingAppointmentDrawer.resyncHold === "function") {
        window.ffBookingAppointmentDrawer.resyncHold();
      }
    } catch (_) {}
  }

  async function syncAppointmentCards() {
    var root = document.getElementById(ROOT_ID);
    var st = state();
    if (!root || !st || !window.ffBookingCalAppointments) return;
    if (st.isWeek && st.isWeek() && typeof window.ffBookingCalAppointments.loadForDates === "function") {
      await window.ffBookingCalAppointments.loadForDates(st.getWeekDateKeys(), st.getLocationId());
    } else {
      await window.ffBookingCalAppointments.loadForView(st.getSelectedDateKey(), st.getLocationId());
    }
    paintOverlays(root);
  }

  async function syncBlocks() {
    var root = document.getElementById(ROOT_ID);
    var st = state();
    var api = window.ffBookingBlocks;
    if (!root || !st || !api) return;
    try {
      if (st.isWeek && st.isWeek() && typeof api.loadForDates === "function") {
        await api.loadForDates(st.getWeekDateKeys(), st.getLocationId());
      } else if (typeof api.loadForView === "function") {
        await api.loadForView(st.getSelectedDateKey(), st.getLocationId());
      }
    } catch (_) {}
    paintOverlays(root);
  }

  function updateNowLine() {
    if (!isCalendarVisible()) return;
    var st = state();
    if (st && st.isWeek && st.isWeek()) {
      if (window.ffBookingCalWeek && typeof window.ffBookingCalWeek.updateNowLine === "function") {
        window.ffBookingCalWeek.updateNowLine();
      }
      return;
    }
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
      el.className = "ff-cal-now ff-cal-print-hide";
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
    var axis = st && st.isWeek && st.isWeek() && window.ffBookingCalWeek
      ? window.ffBookingCalWeek.sharedAxis()
      : (st && st.getAxis ? st.getAxis() : null);
    if (keepScroll) restoreScroll(root, scroll.left, scroll.top);
    else restoreScroll(root, 0, initialScrollTop(axis));
    startNowTimer();
    syncAppointmentCards();
    syncBlocks();
  }

  function cancelActiveDrag() {
    if (window.ffBookingCalDrag && typeof window.ffBookingCalDrag.cancel === "function") {
      window.ffBookingCalDrag.cancel();
    }
  }

  function onAction(act) {
    var st = state();
    if (!st) return;
    if (act === "view-day" || act === "view-week" || act === "today" || act === "prev" || act === "next") {
      cancelActiveDrag();
    }
    if (act === "view-day") {
      if (st.setView) st.setView("day");
      render({ keepScroll: false });
      return;
    }
    if (act === "view-week") {
      if (st.setView) st.setView("week");
      render({ keepScroll: false });
      return;
    }
    if (act === "week-pick") {
      if (window.ffBookingCalWeek && typeof window.ffBookingCalWeek.openPicker === "function") {
        window.ffBookingCalWeek.openPicker(document.querySelector(".ff-cal-week-provider, .ff-cal-week-pick"));
      }
      return;
    }
    if (st.isWeek && st.isWeek()) {
      if (act === "today") st.goThisWeek();
      else if (act === "prev") st.shiftWeek(-1);
      else if (act === "next") st.shiftWeek(1);
      else if (act === "filters") {
        if (window.ffBookingCalFilters && typeof window.ffBookingCalFilters.toggle === "function") {
          window.ffBookingCalFilters.toggle(document.querySelector(".ff-cal-filters"));
        }
        return;
      }
      else if (act === "print") {
        if (window.ffBookingCalPrint && typeof window.ffBookingCalPrint.printCurrent === "function") {
          window.ffBookingCalPrint.printCurrent();
        }
        return;
      }
      else if (act === "clear-focus") {
        if (st.clearVisibleProviders) st.clearVisibleProviders();
        render({ keepScroll: true });
        return;
      }
      else return;
      render({ keepScroll: false });
      return;
    }
    if (act === "today") st.goToday();
    else if (act === "prev") st.shiftDay(-1);
    else if (act === "next") st.shiftDay(1);
    else if (act === "clear-focus") st.clearVisibleProviders ? st.clearVisibleProviders() : st.clearFocusProvider();
    else if (act === "filters") {
      if (window.ffBookingCalFilters && typeof window.ffBookingCalFilters.toggle === "function") {
        window.ffBookingCalFilters.toggle(document.querySelector(".ff-cal-filters"));
      }
      return;
    }
    else if (act === "print") {
      if (window.ffBookingCalPrint && typeof window.ffBookingCalPrint.printCurrent === "function") {
        window.ffBookingCalPrint.printCurrent();
      }
      return;
    }
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
      if (window.ffBookingCalDrag && typeof window.ffBookingCalDrag.consumeClick === "function"
          && window.ffBookingCalDrag.consumeClick()) {
        ev.preventDefault();
        return;
      }
      if (t.closest("[data-ff-cal-hold]")) {
        ev.preventDefault();
        return;
      }
      var blockEl = t.closest("[data-ff-cal-block]");
      if (blockEl) {
        ev.preventDefault();
        openBlockFromEl(blockEl);
        return;
      }
      var card = t.closest("[data-ff-cal-card]");
      if (card) {
        ev.preventDefault();
        if (card.classList.contains("is-stack")) return;
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
      var surface = t.closest("[data-ff-cal-surface]");
      if (st && st.isWeek && st.isWeek()) {
        offerSlotCreate(rememberWeekSlot(ev, surface), ev);
        return;
      }
      offerSlotCreate(rememberSlot(ev, surface), ev);
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
      cancelActiveDrag();
      if (isCalendarVisible()) render({ keepScroll: false });
    });
    document.addEventListener("ff-locations-updated", function () {
      if (isCalendarVisible()) render({ keepScroll: true });
    });
    document.addEventListener("ff-booking-appointment-created", function () {
      if (isCalendarVisible()) {
        syncAppointmentCards();
        syncBlocks();
      }
    });
    document.addEventListener("ff-booking-appointment-updated", function () {
      if (isCalendarVisible()) syncAppointmentCards();
    });
    document.addEventListener("ff-booking-appointment-cancelled", function () {
      if (isCalendarVisible()) syncAppointmentCards();
    });
    document.addEventListener("ff-booking-calendar-draft-changed", function () {
      var root = document.getElementById(ROOT_ID);
      if (root && isCalendarVisible()) paintOverlays(root);
    });
    document.addEventListener("ff-booking-calendar-blocks-changed", function () {
      var root = document.getElementById(ROOT_ID);
      if (root && isCalendarVisible()) paintOverlays(root);
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
  window.ffBookingCalendarCreate = {
    blockedCreate: blockedCreate,
    slotIsOpen: slotIsOpen,
    openAppointmentFromHit: openAppointmentFromHit,
    offerSlotCreate: offerSlotCreate
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
