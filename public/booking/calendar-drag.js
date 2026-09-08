/**
 * Drag a Calendar hold or saved service card to another provider and/or time.
 * Pointer delta snaps to 15-minute slots. Ghost locks to the grid while dragging.
 */
(function () {
  var THRESHOLD = 10;
  var SNAP_MIN = 15;
  var suppressClick = false;
  var session = null;
  var pendingTap = null;

  function layout() { return window.ffBookingCalLayout || null; }
  function calState() { return window.ffBookingCalState || null; }

  function pxPerMinute() {
    var lay = layout();
    var tokens = lay && typeof lay.tokens === "function" ? lay.tokens() : null;
    var n = tokens && Number(tokens.pxPerMinute);
    return n > 0 ? n : 72 / 60;
  }

  function snapStart(fromStartMin, dy) {
    var lay = layout();
    var raw = Number(fromStartMin) + Number(dy) / pxPerMinute();
    if (lay && typeof lay.snapMinutes === "function") return lay.snapMinutes(raw, SNAP_MIN);
    return Math.round(raw / SNAP_MIN) * SNAP_MIN;
  }

  function clampStart(startMin, durationMinutes, axis) {
    var start = Number(startMin);
    if (!axis) return start;
    var dur = Number(durationMinutes) > 0 ? Number(durationMinutes) : SNAP_MIN;
    var min = Number(axis.startMin);
    var max = Number(axis.endMin);
    if (!(max > min)) return start;
    var last = Math.max(min, max - Math.min(dur, max - min));
    if (start < min) return min;
    if (start > last) return last;
    return start;
  }

  function previewFromDelta(source, dy, providerId, axis) {
    if (!source) return null;
    var startMin = clampStart(
      snapStart(source.fromStartMin, dy),
      source.durationMinutes,
      axis
    );
    var id = String(providerId || source.fromProviderId || "").trim();
    if (!id || !Number.isFinite(startMin)) return null;
    return { source: source, providerId: id, startMin: startMin };
  }

  function columnWidth(surface) {
    var board = surface && surface.closest ? surface.closest("[data-ff-cal-board]") : null;
    var raw = board ? getComputedStyle(board).getPropertyValue("--ff-cal-col-w") : "";
    var n = parseFloat(raw);
    return n > 0 ? n : 144;
  }

  function readSource(el) {
    if (!el || typeof el.closest !== "function") return null;
    var hold = el.closest("[data-ff-cal-hold]");
    if (hold) {
      return {
        kind: "hold",
        el: hold,
        lineKey: hold.getAttribute("data-ff-cal-hold-line") || "",
        fromProviderId: hold.getAttribute("data-ff-cal-hold-provider") || "",
        fromStartMin: Number(hold.getAttribute("data-ff-cal-start")),
        durationMinutes: Number(hold.getAttribute("data-ff-cal-duration")) || 30
      };
    }
    var card = el.closest("[data-ff-cal-card]");
    if (card) {
      var col = card.closest("[data-ff-cal-emp]");
      var source = {
        kind: "card",
        el: card,
        appointmentId: card.getAttribute("data-ff-cal-card") || "",
        lineId: card.getAttribute("data-ff-cal-line") || "",
        lineIds: (card.getAttribute("data-ff-cal-lines") || card.getAttribute("data-ff-cal-line") || "")
          .split(",")
          .map(function (id) { return String(id || "").trim(); })
          .filter(Boolean),
        fromProviderId: col ? col.getAttribute("data-ff-cal-emp") || "" : "",
        fromStartMin: Number(card.getAttribute("data-ff-cal-start")),
        durationMinutes: Number(card.getAttribute("data-ff-cal-duration")) || 30,
        requested: card.getAttribute("data-ff-cal-requested") === "1"
      };
      return applySolo(source, card, el);
    }
    return null;
  }

  function findSeg(card, lineId) {
    var id = String(lineId || "");
    if (!card || !id) return null;
    var segs = card.querySelectorAll("[data-ff-cal-seg]");
    for (var i = 0; i < segs.length; i += 1) {
      if (segs[i].getAttribute("data-ff-cal-seg") === id) return segs[i];
    }
    return null;
  }

  function applySolo(source, card, fromEl) {
    if (!source || !card) return source;
    var lines = source.lineIds || [];
    if (lines.length < 2) return source;
    var seg = fromEl && fromEl.closest ? fromEl.closest("[data-ff-cal-seg]") : null;
    if (!seg) {
      var focus = card.getAttribute("data-ff-cal-focus-line");
      seg = findSeg(card, focus);
    }
    if (!seg) return source;
    var id = String(seg.getAttribute("data-ff-cal-seg") || "").trim();
    if (!id) return source;
    source.lineId = id;
    source.lineIds = [id];
    source.fromStartMin = Number(seg.getAttribute("data-ff-cal-seg-start"));
    source.durationMinutes = Number(seg.getAttribute("data-ff-cal-seg-duration")) || source.durationMinutes;
    source.requested = seg.getAttribute("data-ff-cal-seg-requested") === "1";
    source.solo = true;
    source.segEl = seg;
    return source;
  }

  function dragLines(source) {
    if (!source) return [];
    if (source.solo && source.lineId) return [String(source.lineId)];
    if (source.lineIds && source.lineIds.length) return source.lineIds.slice();
    return source.lineId ? [String(source.lineId)] : [];
  }

  function clearSegmentFocus(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    scope.querySelectorAll("[data-ff-cal-focus-line]").forEach(function (card) {
      card.removeAttribute("data-ff-cal-focus-line");
    });
    scope.querySelectorAll(".ff-cal-card-seg.is-focus").forEach(function (seg) {
      seg.classList.remove("is-focus");
    });
  }

  function focusSegment(card, lineId) {
    if (!card) return false;
    var id = String(lineId || "");
    var seg = findSeg(card, id);
    if (!seg) return false;
    clearSegmentFocus(document);
    card.setAttribute("data-ff-cal-focus-line", id);
    seg.classList.add("is-focus");
    return true;
  }

  function cancelPendingTap() {
    if (pendingTap) clearTimeout(pendingTap);
    pendingTap = null;
  }

  function dropAction(source, hit) {
    var preview = hit && hit.dy == null && Number.isFinite(Number(hit.startMin))
      ? {
        source: source,
        providerId: String(hit.providerId || "").trim(),
        startMin: Number(hit.startMin)
      }
      : previewFromDelta(
        source,
        hit && hit.dy != null ? hit.dy : 0,
        hit && hit.providerId,
        hit && hit.axis
      );
    if (!preview || !preview.providerId) return null;
    if (source.kind === "hold" && !source.lineKey) return null;
    if (source.kind === "card" && (!source.appointmentId || !source.lineId)) return null;
    var sameProvider = preview.providerId === String(source.fromProviderId || "");
    var sameTime = preview.startMin === Number(source.fromStartMin);
    if (sameProvider && sameTime) return null;
    return preview;
  }

  function findCol(providerId) {
    var id = String(providerId || "");
    if (!id) return null;
    var cols = document.querySelectorAll("[data-ff-cal-emp]");
    for (var i = 0; i < cols.length; i += 1) {
      if (cols[i].getAttribute("data-ff-cal-emp") === id) return cols[i];
    }
    return null;
  }

  function captureGeo() {
    var surface = document.querySelector("[data-ff-cal-surface]");
    var lay = layout();
    var st = calState();
    if (!surface || !lay || !st) return null;
    return {
      surface: surface,
      rect: surface.getBoundingClientRect(),
      employees: (st.getVisibleEmployees && st.getVisibleEmployees()) || st.getEmployees() || [],
      axis: st.getAxis(),
      dateKey: st.getSelectedDateKey(),
      columnWidth: columnWidth(surface)
    };
  }

  function hitAt(clientX, clientY, geo) {
    var lay = layout();
    var area = geo || captureGeo();
    if (!lay || !area) return null;
    return lay.hitTest(clientX - area.rect.left, clientY - area.rect.top, {
      employees: area.employees,
      axis: area.axis,
      dateKey: area.dateKey,
      columnWidth: area.columnWidth
    });
  }

  function providerAtX(clientX) {
    var cols = document.querySelectorAll("[data-ff-cal-emp]");
    if (!cols.length) return "";
    var i;
    var nearest = "";
    var nearestDist = Infinity;
    for (i = 0; i < cols.length; i += 1) {
      var rect = cols[i].getBoundingClientRect();
      var id = cols[i].getAttribute("data-ff-cal-emp") || "";
      if (clientX >= rect.left && clientX < rect.right) return id;
      var mid = (rect.left + rect.right) / 2;
      var dist = Math.abs(clientX - mid);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = id;
      }
    }
    return nearest;
  }

  function previewAt(clientX, clientY, sess) {
    var area = (sess && sess.geo) || captureGeo();
    if (!sess || !sess.source || !area) return null;
    return previewFromDelta(
      sess.source,
      clientY - sess.startY,
      providerAtX(clientX) || sess.source.fromProviderId,
      area.axis
    );
  }

  function clearDrop() {
    if (session && session.dropCol) {
      session.dropCol.classList.remove("is-drop");
      session.dropCol = null;
    }
  }

  function markDrop(providerId) {
    if (session && session.dropProviderId === providerId) return;
    if (session) session.dropProviderId = providerId || "";
    clearDrop();
    var col = findCol(providerId);
    if (col) {
      col.classList.add("is-drop");
      if (session) session.dropCol = col;
    }
  }

  function providerName(providerId) {
    var id = String(providerId || "").trim();
    if (!id) return "this provider";
    var st = calState();
    var list = [];
    try {
      if (st && typeof st.getVisibleEmployees === "function") list = st.getVisibleEmployees() || [];
      if ((!list || !list.length) && st && typeof st.getEmployees === "function") list = st.getEmployees() || [];
    } catch (_) {}
    var emp = (list || []).find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    });
    if (!emp) return id;
    var name = String(emp.firstName || emp.name || emp.displayName || "").trim();
    return name || id;
  }

  function isProviderChange(action) {
    return !!(
      action &&
      action.source &&
      action.source.kind === "card" &&
      String(action.providerId || "") &&
      String(action.providerId || "") !== String(action.source.fromProviderId || "")
    );
  }

  function providerMovePrompt(fromName, toName, requested) {
    if (requested) {
      return "Pay attention, this is a requested appointment. Are you sure you want to move it from " +
        String(fromName || "this provider") + " to " + String(toName || "another person") +
        "? Keep the request for " + String(toName || "another person") + ", or move without a request?";
    }
    return "Are you sure you want to move this appointment from " +
      String(fromName || "this provider") + " to " + String(toName || "this provider") + "?";
  }

  function requestedMoveActions(toName) {
    var name = String(toName || "another person");
    return {
      keep: "Move as request to " + name,
      drop: "Move without request to " + name
    };
  }

  function moveAskResult(act) {
    if (act === "request") return { ok: true, keepRequest: true };
    if (act === "plain") return { ok: true, keepRequest: false };
    if (act === "yes") return { ok: true };
    return { ok: false };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var moveAsk = null;

  function closeMoveAsk(result) {
    var box = document.getElementById("ffCalMoveConfirm");
    if (box) {
      box.hidden = true;
      box.classList.remove("is-open");
      box.classList.remove("is-request");
    }
    var done = moveAsk;
    moveAsk = null;
    if (done) done(result && result.ok ? result : { ok: false });
  }

  function ensureMoveAsk() {
    var box = document.getElementById("ffCalMoveConfirm");
    if (box) return box;
    box = document.createElement("div");
    box.id = "ffCalMoveConfirm";
    box.className = "ff-cal-move";
    box.hidden = true;
    box.innerHTML =
      '<div class="ff-cal-move-card" role="dialog" aria-modal="true" aria-labelledby="ffCalMoveTitle">' +
        "<h3 id=\"ffCalMoveTitle\">Move appointment?</h3>" +
        '<p id="ffCalMoveCopy"></p>' +
        '<div class="ff-cal-move-acts">' +
          '<button type="button" class="ff-cal-move-cancel" data-ff-cal-move="no">Cancel</button>' +
          '<button type="button" class="ff-cal-move-go" data-ff-cal-move="yes">Move</button>' +
        "</div>" +
      "</div>";
    var host = document.getElementById("ffBookingWorkspace") || document.body;
    host.appendChild(box);
    box.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cal-move]") : null;
      if (act) {
        closeMoveAsk(moveAskResult(act.getAttribute("data-ff-cal-move")));
        return;
      }
      if (ev.target === box) closeMoveAsk({ ok: false });
    });
    return box;
  }

  function renderMoveActions(requested, toName) {
    var acts = document.querySelector("#ffCalMoveConfirm .ff-cal-move-acts");
    if (!acts) return;
    if (requested) {
      var labels = requestedMoveActions(toName);
      acts.innerHTML =
        '<button type="button" class="ff-cal-move-go" data-ff-cal-move="request">' + escapeHtml(labels.keep) + "</button>" +
        '<button type="button" class="ff-cal-move-plain" data-ff-cal-move="plain">' + escapeHtml(labels.drop) + "</button>" +
        '<button type="button" class="ff-cal-move-cancel" data-ff-cal-move="no">Cancel</button>';
      return;
    }
    acts.innerHTML =
      '<button type="button" class="ff-cal-move-cancel" data-ff-cal-move="no">Cancel</button>' +
      '<button type="button" class="ff-cal-move-go" data-ff-cal-move="yes">Move</button>';
  }

  function askMoveConfirm(fromName, toName, requested) {
    var box = ensureMoveAsk();
    box.classList.toggle("is-request", !!requested);
    var title = document.getElementById("ffCalMoveTitle");
    if (title) title.textContent = requested ? "Pay attention" : "Move appointment?";
    var copy = document.getElementById("ffCalMoveCopy");
    if (copy) {
      copy.innerHTML = requested
        ? "This is a requested appointment. Are you sure you want to move it from <strong>" +
          escapeHtml(fromName || "this provider") + "</strong> to <strong>" +
          escapeHtml(toName || "another person") +
          "</strong>? Keep the request for <strong>" + escapeHtml(toName || "another person") +
          "</strong>, or move without a request?"
        : "Are you sure you want to move this appointment from <strong>" +
          escapeHtml(fromName || "this provider") + "</strong> to <strong>" +
          escapeHtml(toName || "this provider") + "</strong>?";
    }
    renderMoveActions(requested, toName);
    box.hidden = false;
    box.classList.add("is-open");
    var go = box.querySelector(requested ? '[data-ff-cal-move="request"]' : '[data-ff-cal-move="yes"]');
    if (go) go.focus();
    return new Promise(function (resolve) {
      if (moveAsk) moveAsk({ ok: false });
      moveAsk = resolve;
    });
  }

  function confirmProviderMove(action) {
    if (!isProviderChange(action)) return Promise.resolve({ ok: true });
    return askMoveConfirm(
      providerName(action.source.fromProviderId),
      providerName(action.providerId),
      !!action.source.requested
    );
  }

  function toastError(message) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: "error", durationMs: 3200 });
    }
  }

  function assignHold(lineKey, providerId, startMin) {
    var drawer = window.ffBookingAppointmentDrawer;
    if (!drawer || typeof drawer.assignLineSlot !== "function") return Promise.resolve(false);
    return drawer.assignLineSlot(lineKey, providerId, startMin);
  }

  async function assignCard(appointmentId, lineIds, providerId, startMin, keepRequest, fromStartMin) {
    var repo = window.ffBookingAppointments;
    var store = window.ffBookingCalAppointments;
    var model = window.ffBookingAppointmentModel;
    var st = calState();
    if (!repo || typeof repo.updateAppointment !== "function") return;
    var appt = store && typeof store.getCachedById === "function" ? store.getCachedById(appointmentId) : null;
    if (!appt && typeof repo.getAppointmentById === "function") {
      try { appt = await repo.getAppointmentById(appointmentId); } catch (_) { appt = null; }
    }
    if (!appt) {
      toastError("This appointment could not be moved.");
      return;
    }
    var ids = {};
    (Array.isArray(lineIds) ? lineIds : [lineIds]).forEach(function (id) {
      if (id) ids[String(id)] = true;
    });
    var delta = Number(startMin) - Number(fromStartMin);
    if (!Number.isFinite(delta)) delta = 0;
    var dateKey = st && typeof st.getSelectedDateKey === "function" ? st.getSelectedDateKey() : appt.dateKey;
    var lines = (appt.serviceLines || []).map(function (line) {
      if (!line || !ids[String(line.lineId || "")]) return line;
      var duration = Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30;
      var next = Object.assign({}, line, { providerId: providerId });
      if (keepRequest === true) next.requested = true;
      if (keepRequest === false) next.requested = false;
      if (Number.isFinite(Number(startMin)) && model && typeof model.civilToDate === "function") {
        var lineStart = Number(fromStartMin) + delta;
        var tm = window.ffBookingTime;
        if (tm && typeof tm.zonedMinutes === "function") {
          var current = tm.zonedMinutes(
            model.toDate ? model.toDate(line.startAt) : line.startAt,
            appt.locationId
          );
          if (Number.isFinite(current)) lineStart = current + delta;
        }
        next.startAt = model.civilToDate(dateKey, lineStart, appt.locationId);
        next.endAt = model.civilToDate(dateKey, lineStart + duration, appt.locationId);
        next.durationMinutes = duration;
      }
      return next;
    });
    appt.serviceLines = lines;
    if (window.ffBookingCalCardRender && typeof window.ffBookingCalCardRender.paint === "function") {
      try { window.ffBookingCalCardRender.paint(); } catch (_) {}
    }
    var result;
    try {
      result = await repo.updateAppointment(appointmentId, {
        serviceLines: lines,
        gapsAcknowledged: true
      });
    } catch (err) {
      toastError(err && err.message ? err.message : "This service could not be moved.");
      return;
    }
    if (result && result.ok) return;
    var form = window.ffBookingAppointmentForm;
    var msg = form && typeof form.friendlyError === "function"
      ? form.friendlyError(result && result.code, providerId)
      : (result && result.error) || "This service could not be moved.";
    toastError(msg);
  }

  function applyDrop(action) {
    if (!action) return Promise.resolve(false);
    return confirmProviderMove(action).then(function (choice) {
      if (!choice || !choice.ok) {
        restoreSource();
        return false;
      }
      if (action.source.kind === "hold") {
        assignHold(action.source.lineKey, action.providerId, action.startMin);
        return true;
      }
      assignCard(
        action.source.appointmentId,
        dragLines(action.source),
        action.providerId,
        action.startMin,
        choice.keepRequest,
        action.source.fromStartMin
      );
      return true;
    });
  }

  function makeGhost(el, clientX, clientY, source) {
    var lift = source && source.solo && source.segEl ? source.segEl : el;
    var rect = lift.getBoundingClientRect();
    var width = Math.max(8, rect.width);
    var height = Math.max(28, rect.height);
    var ghost = document.createElement("div");
    var statusClass = "";
    var extraClass = "";
    if (el.classList) {
      el.classList.forEach(function (name) {
        if (String(name).indexOf("is-status-") === 0) statusClass = name;
        if (name === "is-new-client") extraClass += " is-new-client";
        if (name === "is-requested") extraClass += " is-requested";
        if (name === "is-stack" && !(source && source.solo)) extraClass += " is-stack";
      });
    }
    var cs = null;
    try { cs = window.getComputedStyle(el); } catch (_) { cs = null; }
    ghost.className = ("ff-cal-drag-ghost" + (statusClass ? " " + statusClass : "") + extraClass).trim();
    ghost.setAttribute("data-ff-cal-lift", "1");
    ghost.innerHTML = (source && source.solo && lift) ? lift.innerHTML : el.innerHTML;
    ghost.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:" + width + "px",
      "height:" + height + "px",
      "z-index:2147483646",
      "visibility:visible",
      "opacity:1",
      "display:block",
      "pointer-events:none",
      "margin:0",
      "box-sizing:border-box",
      "padding:" + (extraClass.indexOf("is-stack") !== -1 && !(source && source.solo) ? "0" : "5px 7px"),
      "overflow:hidden",
      "border-radius:8px",
      "background:" + (cs && cs.backgroundColor ? cs.backgroundColor : "#f5f3ff"),
      "border:" + (cs && cs.border ? cs.border : "1px solid #c4b5fd"),
      "border-left:" + (cs && cs.borderLeft ? cs.borderLeft : "3px solid #9d68b9"),
      "color:" + (cs && cs.color ? cs.color : "#111111"),
      "font-size:10.5px",
      "font-weight:400",
      "line-height:1.25",
      "box-shadow:0 14px 32px rgba(31,22,51,0.2)",
      "transform:translate3d(" + rect.left + "px," + rect.top + "px,0)"
    ].join(";");
    document.body.appendChild(ghost);
    return {
      el: ghost,
      originX: rect.left,
      originY: rect.top,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      width: width,
      height: height
    };
  }

  function clockLabel(startMin, durationMinutes) {
    var form = window.ffBookingAppointmentForm;
    if (form && typeof form.formatMinutes === "function") {
      var end = Number(startMin) + (Number(durationMinutes) > 0 ? Number(durationMinutes) : 0);
      return form.formatMinutes(startMin) + (end > startMin ? " – " + form.formatMinutes(end) : "");
    }
    return "";
  }

  function updateGhostTime(ghost, startMin, durationMinutes) {
    if (!ghost || !ghost.el) return;
    var label = clockLabel(startMin, durationMinutes);
    if (!label) return;
    var timeEl = ghost.el.querySelector(".ff-cal-card-time, .ff-cal-hold-time");
    if (timeEl) timeEl.textContent = label;
  }

  function moveGhost(sess, clientX, clientY, preview) {
    var ghost = sess && sess.ghost;
    if (!ghost || !ghost.el) return;
    var y = clientY - ghost.offsetY;
    var x = clientX - ghost.offsetX;
    var col = preview ? findCol(preview.providerId) : null;
    if (col) {
      var colRect = col.getBoundingClientRect();
      var inset = 4;
      x = colRect.left + inset;
      ghost.el.style.width = Math.max(40, colRect.width - inset * 2) + "px";
    }
    ghost.el.style.transform = "translate3d(" + x + "px," + y + "px,0)";
  }

  function restoreSource() {
    var sourceEl = session && session.source && session.source.el;
    if (sourceEl) sourceEl.classList.remove("is-dragging");
    if (window.ffBookingCalDraft && typeof window.ffBookingCalDraft.sync === "function") {
      try { window.ffBookingCalDraft.sync(); } catch (_) {}
    }
    if (window.ffBookingCalCardRender && typeof window.ffBookingCalCardRender.paint === "function") {
      try { window.ffBookingCalCardRender.paint(); } catch (_) {}
    }
  }

  function endSession(moved) {
    if (session && session.ghost && session.ghost.el && session.ghost.el.parentNode) {
      session.ghost.el.parentNode.removeChild(session.ghost.el);
    }
    restoreSource();
    clearDrop();
    if (moved) suppressClick = true;
    session = null;
  }

  function consumeClick() {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  }

  function releaseOpensDetails(source, action) {
    return !!(source && source.kind === "card" && source.appointmentId && !action);
  }

  function openCardDetails(source) {
    if (!releaseOpensDetails(source, null)) return;
    var details = window.ffBookingAppointmentDetails;
    if (details && typeof details.open === "function") {
      details.open({
        appointmentId: source.appointmentId,
        lineId: source.lineId
      });
    }
  }

  function onPointerDown(ev) {
    if (ev.button != null && ev.button !== 0) return;
    cancelPendingTap();
    var source = readSource(ev.target);
    if (!source) return;
    session = {
      source: source,
      startX: ev.clientX,
      startY: ev.clientY,
      dragging: false,
      ghost: null,
      geo: null,
      dropCol: null,
      dropProviderId: ""
    };
  }

  function onPointerMove(ev) {
    if (!session) return;
    var dx = ev.clientX - session.startX;
    var dy = ev.clientY - session.startY;
    if (!session.dragging) {
      if ((dx * dx + dy * dy) < THRESHOLD * THRESHOLD) return;
      session.dragging = true;
      session.geo = captureGeo();
      session.ghost = makeGhost(session.source.el, ev.clientX, ev.clientY, session.source);
      if (session.ghost && session.ghost.el && session.ghost.el.parentNode) {
        session.source.el.classList.add("is-dragging");
      }
      try { session.source.el.setPointerCapture(ev.pointerId); } catch (_) {}
    }
    ev.preventDefault();
    var preview = previewAt(ev.clientX, ev.clientY, session);
    moveGhost(session, ev.clientX, ev.clientY, preview);
    if (preview) {
      markDrop(preview.providerId);
      updateGhostTime(session.ghost, preview.startMin, session.source.durationMinutes);
    }
  }

  function onPointerUp(ev) {
    if (!session) return;
    var moved = session.dragging;
    var action = null;
    if (moved) {
      var preview = previewAt(ev.clientX, ev.clientY, session);
      action = dropAction(session.source, {
        providerId: preview && preview.providerId,
        dy: ev.clientY - session.startY,
        axis: session.geo && session.geo.axis
      });
    }
    if (session.ghost && session.ghost.el && session.ghost.el.parentNode) {
      session.ghost.el.parentNode.removeChild(session.ghost.el);
      session.ghost = null;
    }
    if (action) {
      if (session.source && session.source.el) session.source.el.classList.add("is-dragging");
      applyDrop(action);
      if (session.source && session.source.el) session.source.el.classList.remove("is-dragging");
      clearDrop();
      suppressClick = true;
      session = null;
      return;
    }
    var source = session.source;
    endSession(false);
    if (!releaseOpensDetails(source, action)) return;
    suppressClick = true;
    var stacked = source.el && source.el.classList && source.el.classList.contains("is-stack");
    if (!stacked) {
      openCardDetails(source);
      return;
    }
    cancelPendingTap();
    pendingTap = setTimeout(function () {
      pendingTap = null;
      openCardDetails(source);
    }, 280);
  }

  function bind() {
    if (typeof document === "undefined" || !document.documentElement) return;
    if (document.documentElement.getAttribute("data-ff-cal-drag-bound")) return;
    document.documentElement.setAttribute("data-ff-cal-drag-bound", "1");
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", function () { endSession(false); }, true);
    document.addEventListener("dblclick", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var seg = t.closest("[data-ff-cal-seg]");
      var card = t.closest("[data-ff-cal-card]");
      if (!seg || !card || !card.classList.contains("is-stack")) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelPendingTap();
      suppressClick = true;
      focusSegment(card, seg.getAttribute("data-ff-cal-seg"));
    }, true);
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var box = document.getElementById("ffCalMoveConfirm");
      if (box && !box.hidden) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoveAsk({ ok: false });
        return;
      }
      clearSegmentFocus();
    }, true);
  }

  window.ffBookingCalDrag = {
    bind: bind,
    readSource: readSource,
    dropAction: dropAction,
    dragLines: dragLines,
    focusSegment: focusSegment,
    clearSegmentFocus: clearSegmentFocus,
    previewFromDelta: previewFromDelta,
    isProviderChange: isProviderChange,
    providerMovePrompt: providerMovePrompt,
    requestedMoveActions: requestedMoveActions,
    moveAskResult: moveAskResult,
    consumeClick: consumeClick,
    releaseOpensDetails: releaseOpensDetails,
    THRESHOLD: THRESHOLD,
    SNAP_MIN: SNAP_MIN
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
    else bind();
  }
})();
