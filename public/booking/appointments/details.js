/**
 * Appointment Details drawer with in-place Edit Mode.
 * Writes go only through ffBookingAppointments.updateAppointment.
 */
(function () {
  var ROOT_ID = "ffBookingApptDetails";
  var current = null;
  var mode = "view";
  var edit = null;
  var cancelling = false;
  var statusSaving = false;
  var editUi = {
    servicePickerKey: "",
    providerPickerKey: "",
    serviceQ: "",
    providerQ: "",
    expandedCats: {}
  };

  function resetEditUi() {
    editUi.servicePickerKey = "";
    editUi.providerPickerKey = "";
    editUi.serviceQ = "";
    editUi.providerQ = "";
    editUi.expandedCats = {};
  }

  function statusApi() { return window.ffBookingAppointmentStatus || null; }
  function live() { return window.ffBookingDrawerLive || null; }
  function calAppts() { return window.ffBookingCalAppointments || null; }
  function repo() { return window.ffBookingAppointments || null; }
  function model() { return window.ffBookingAppointmentModel || null; }
  function form() { return window.ffBookingAppointmentForm || null; }

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function canOpen() {
    var workspace = document.getElementById("ffBookingWorkspace");
    if (workspace && workspace.hasAttribute("hidden")) return false;
    var shell = window.ffBookingState;
    if (shell && !shell.isBooking()) return false;
    return !!document.getElementById("ffBookingCalendarRoot");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function initials(name) {
    var parts = trim(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  }

  function formatMinutes(total) {
    if (form() && form().formatMinutes) return form().formatMinutes(total);
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  function toDate(value) {
    if (model() && typeof model().toDate === "function") return model().toDate(value);
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") {
      try { return value.toDate(); } catch (_) { return null; }
    }
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    return null;
  }

  function minutesOf(value, locationId) {
    var date = toDate(value);
    var tm = window.ffBookingTime;
    if (!date || !tm || typeof tm.zonedMinutes !== "function") return null;
    var min = tm.zonedMinutes(date, locationId);
    return Number.isFinite(min) ? min : null;
  }

  function pickLine(appointment, lineId) {
    var lines = appointment && Array.isArray(appointment.serviceLines) ? appointment.serviceLines : [];
    var id = trim(lineId);
    var hit = id ? lines.find(function (line) { return line && trim(line.lineId) === id; }) : null;
    return hit || lines[0] || null;
  }

  function findProvider(providerId) {
    var id = trim(providerId);
    if (!id) return null;
    var st = window.ffBookingCalState;
    var list = [];
    try {
      if (st && typeof st.getEmployees === "function") list = st.getEmployees() || [];
    } catch (_) {}
    var emp = list.find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    });
    if (emp) return emp;
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        list = store && Array.isArray(store.staff) ? store.staff : [];
      }
    } catch (_) { list = []; }
    return list.find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    }) || null;
  }

  function locationLabel(locationId) {
    try {
      var list = typeof window.ffGetLocations === "function" ? window.ffGetLocations() : [];
      var row = (list || []).find(function (loc) {
        return loc && (String(loc.id || "") === String(locationId) || String(loc.locationId || "") === String(locationId));
      });
      if (row && (row.name || row.label || row.title)) return row.name || row.label || row.title;
    } catch (_) {}
    return "";
  }

  function statusLabel(status) {
    var api = statusApi();
    if (api && typeof api.label === "function") return api.label(status);
    var key = trim(status);
    if (!key) return "";
    return key.replace(/_/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function statusHint(status) {
    var api = statusApi();
    return api && typeof api.hint === "function" ? api.hint(status) : "";
  }

  function statusActions(status) {
    var api = statusApi();
    return api && typeof api.actions === "function" ? api.actions(status) : [];
  }

  function statusClass(status) {
    var api = statusApi();
    return api && typeof api.cardClass === "function" ? api.cardClass(status) : "";
  }

  function lineView(appointment, line) {
    var locationId = appointment && appointment.locationId ? appointment.locationId : "";
    var startMin = line ? minutesOf(line.startAt, locationId) : null;
    var endMin = line ? minutesOf(line.endAt, locationId) : null;
    var duration = line && Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 0;
    if (!duration && startMin != null && endMin != null && endMin > startMin) duration = endMin - startMin;
    if (startMin != null && (endMin == null || endMin <= startMin) && duration) endMin = startMin + duration;
    var provider = line ? findProvider(line.providerId) : null;
    var providerName = trim(line && line.providerNameSnapshot)
      || trim(provider && (provider.firstName || provider.name || provider.displayName))
      || "Provider";
    var photo = trim(provider && (provider.photoURL || provider.avatarUrl || provider.photoUrl || provider.imageUrl));
    return {
      lineId: trim(line && line.lineId),
      serviceName: trim(line && line.serviceNameSnapshot) || "Service",
      duration: duration,
      durationLabel: duration ? duration + " min" : "—",
      startMin: startMin,
      endMin: endMin,
      startLabel: startMin != null ? formatMinutes(startMin) : "—",
      endLabel: endMin != null ? formatMinutes(endMin) : "—",
      price: Number(line && line.priceSnapshot) || 0,
      priceLabel: money(line && line.priceSnapshot),
      providerName: providerName,
      providerPhoto: photo,
      guestName: trim(line && line.guestName),
      guestKey: trim(line && line.guestKey),
      requested: !!(line && line.requested)
    };
  }

  function viewFrom(appointment, lineId) {
    var snap = appointment && appointment.clientSnapshot && typeof appointment.clientSnapshot === "object"
      ? appointment.clientSnapshot
      : {};
    var locationId = appointment && appointment.locationId ? appointment.locationId : "";
    var services = (appointment && appointment.serviceLines || []).map(function (line) {
      return lineView(appointment, line);
    });
    var line = pickLine(appointment, lineId);
    var selected = lineView(appointment, line);
    var total = services.reduce(function (sum, row) { return sum + (Number(row.price) || 0); }, 0);
    var dateKey = trim(appointment && appointment.dateKey);
    if (!dateKey && window.ffBookingTime && appointment && appointment.startAt) {
      var startDate = toDate(appointment.startAt);
      if (startDate && typeof window.ffBookingTime.zonedDateKey === "function") {
        dateKey = window.ffBookingTime.zonedDateKey(startDate, locationId) || "";
      }
    }
    var dateLabel = "";
    if (dateKey && window.ffBookingTime && typeof window.ffBookingTime.formatDisplayDate === "function") {
      dateLabel = window.ffBookingTime.formatDisplayDate(dateKey);
    }
    var notes = trim(appointment && appointment.notes);
    var clientName = trim(snap.displayName) || "Client";
    var clientPhone = trim(snap.phone);
    var clientEmail = trim(snap.email);
    return {
      appointmentId: trim(appointment && appointment.appointmentId),
      clientName: clientName,
      clientPhone: clientPhone,
      clientEmail: clientEmail,
      clientSecondary: clientPhone || clientEmail,
      clientInitials: initials(clientName),
      serviceName: selected.serviceName,
      durationLabel: selected.durationLabel,
      startLabel: selected.startLabel,
      endLabel: selected.endLabel,
      priceLabel: selected.priceLabel,
      providerName: selected.providerName,
      providerPhoto: selected.providerPhoto,
      services: services,
      total: total,
      totalLabel: money(total),
      dateKey: dateKey,
      dateLabel: dateLabel || "—",
      locationLabel: locationLabel(locationId) || "—",
      notes: notes,
      notesEmpty: !notes,
      status: trim(appointment && appointment.status) || "scheduled",
      statusLabel: statusLabel(appointment && appointment.status),
      isCancelled: trim(appointment && appointment.status) === "cancelled",
      canCheckIn: statusActions(appointment && appointment.status).some(function (act) {
        return act && act.id === "check-in";
      }),
      statusHint: statusHint(appointment && appointment.status),
      statusClass: statusClass(appointment && appointment.status),
      statusActions: statusActions(appointment && appointment.status),
      isNewClient: !!(appointment && appointment.firstVisit),
      cancellationReason: trim(appointment && appointment.cancellationReason),
      partySize: (function () {
        var api = form();
        if (api && typeof api.partySize === "function") {
          return api.partySize({
            lines: services.map(function (row, index) {
              return {
                key: row.lineId || ("view_" + index),
                serviceId: row.lineId || ("view_" + index),
                service: { name: row.serviceName },
                startMin: row.startMin,
                endMin: row.endMin,
                guestKey: row.guestKey,
                guestName: row.guestName
              };
            })
          });
        }
        var modelApi = model();
        if (modelApi && typeof modelApi.partySizeForVisit === "function") {
          return modelApi.partySizeForVisit(services);
        }
        return 1;
      }())
    };
  }

  function servicesHtml(view) {
    var rows = view && view.services || [];
    if (!rows.length) {
      return '<div class="ff-apd-value">' + escapeHtml(view && view.serviceName || "Service") + "</div>";
    }
    var api = form();
    var fake = {
      client: { displayName: trim(view && view.clientName) },
      lines: rows.map(function (row, index) {
        return {
          key: row.lineId || ("view_" + index),
          serviceId: row.lineId || ("view_" + index),
          service: { name: row.serviceName },
          startMin: row.startMin,
          endMin: row.endMin,
          guestKey: row.guestKey,
          guestName: row.guestName
        };
      })
    };
    var party = api && typeof api.partyNoticeHtml === "function" ? api.partyNoticeHtml(fake) : "";
    var after = {};
    if (api && typeof api.findGaps === "function") {
      api.findGaps(fake).forEach(function (gap) {
        after[gap.prevKey] = api.gapNoticeHtml(gap, { gapReadOnly: true });
      });
    }
    return party + rows.map(function (row, index) {
      var key = row.lineId || ("view_" + index);
      var forName = trim(row.guestName) || trim(view && view.clientName) || "Client";
      var showFor = Number(view && view.partySize) > 1 || !!trim(row.guestName);
      return (
        '<article class="ff-apd-svc">' +
          "<strong>" + escapeHtml(row.serviceName) + "</strong>" +
          (showFor ? "<span>For " + escapeHtml(forName) + "</span>" : "") +
          "<span>" + escapeHtml(row.providerName) +
            (row.requested
              ? '<em class="ff-apd-request" title="Requested for this provider" aria-label="Requested for this provider"></em>'
              : "") +
          "</span>" +
          "<span>" + escapeHtml(row.startLabel + " – " + row.endLabel) + "</span>" +
          "<span>" + escapeHtml(row.durationLabel + " · " + row.priceLabel) + "</span>" +
        "</article>" +
        (after[key] || "")
      );
    }).join("");
  }

  function clientHtml(view) {
    return (
      '<div class="ff-apd-client' + (view.isNewClient ? " is-new-client" : "") + '">' +
        '<span class="ff-apd-avatar ff-apd-initials">' + escapeHtml(view.clientInitials) + "</span>" +
        '<div class="ff-apd-client-id">' +
          "<strong>" + escapeHtml(view.clientName) +
            (view.isNewClient ? '<em class="ff-apd-new-client">New Client</em>' : "") +
          "</strong>" +
          (view.clientSecondary ? "<span>" + escapeHtml(view.clientSecondary) + "</span>" : "") +
        "</div>" +
      "</div>"
    );
  }

  function providerHtml(view) {
    var avatar = view.providerPhoto
      ? '<img class="ff-apd-avatar" src="' + escapeHtml(view.providerPhoto) + '" alt="">'
      : '<span class="ff-apd-avatar ff-apd-initials">' + escapeHtml(initials(view.providerName)) + "</span>";
    return (
      '<div class="ff-apd-provider">' +
        avatar +
        '<div class="ff-apd-value">' + escapeHtml(view.providerName) + "</div>" +
      "</div>"
    );
  }

  function providersForEdit(state) {
    var data = window.ffBookingCalData;
    var list = [];
    if (data && typeof data.loadCalendarEmployees === "function") {
      list = data.loadCalendarEmployees(state.dateKey, state.locationId) || [];
    }
    var ids = {};
    if (state.providerId) ids[state.providerId] = true;
    (state.lines || []).forEach(function (line) {
      if (line && line.providerId) ids[line.providerId] = true;
    });
    var api = form();
    Object.keys(ids).forEach(function (id) {
      if (!list.some(function (emp) { return emp && emp.id === id; })) {
        list = list.concat([{
          id: id,
          firstName: api ? api.providerName(id) : "Provider"
        }]);
      }
    });
    return list;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      title: document.getElementById("ffApdTitle"),
      view: document.getElementById("ffApdView"),
      edit: document.getElementById("ffApdEdit"),
      footView: document.getElementById("ffApdFootView"),
      footEdit: document.getElementById("ffApdFootEdit"),
      client: document.getElementById("ffApdClient"),
      editClient: document.getElementById("ffApdEditClient"),
      services: document.getElementById("ffApdServices"),
      total: document.getElementById("ffApdTotal"),
      date: document.getElementById("ffApdDate"),
      location: document.getElementById("ffApdLocation"),
      editLocation: document.getElementById("ffApdEditLocation"),
      notes: document.getElementById("ffApdNotes"),
      statusRow: document.getElementById("ffApdStatusRow"),
      status: document.getElementById("ffApdStatus"),
      statusHint: document.getElementById("ffApdStatusHint"),
      dateIn: document.getElementById("ffApdDateIn"),
      lines: document.getElementById("ffApdLines"),
      addRow: document.getElementById("ffApdAddRow"),
      notesIn: document.getElementById("ffApdNotesIn"),
      error: document.getElementById("ffApdError"),
      save: document.getElementById("ffApdSave"),
      reasonRow: document.getElementById("ffApdReasonRow"),
      reason: document.getElementById("ffApdReason"),
      confirm: document.getElementById("ffApdCancel"),
      confirmReason: document.getElementById("ffApdCancelReason"),
      confirmError: document.getElementById("ffApdCancelError"),
      confirmKeep: document.getElementById("ffApdKeep"),
      confirmGo: document.getElementById("ffApdConfirmCancel"),
      cancelBtn: document.getElementById("ffApdCancelBtn"),
      statusActs: document.getElementById("ffApdStatusActs"),
      editBtn: document.getElementById("ffApdEditBtn"),
      closeCancelled: document.getElementById("ffApdCloseCancelled")
    };
  }

  function paintView(ui, view) {
    ui.client.innerHTML = clientHtml(view);
    if (ui.services) ui.services.innerHTML = servicesHtml(view);
    if (ui.total) ui.total.textContent = view.totalLabel;
    ui.date.textContent = view.dateLabel;
    ui.location.textContent = view.locationLabel;
    ui.notes.textContent = view.notesEmpty ? "No notes" : view.notes;
    ui.notes.classList.toggle("is-empty", view.notesEmpty);
    ui.statusRow.hidden = !view.statusLabel;
    if (ui.status) {
      ui.status.className = ("ff-apd-status " + (view.statusClass || "")).trim();
      ui.status.textContent = view.statusLabel;
    }
    if (ui.statusHint) {
      ui.statusHint.hidden = !view.statusHint;
      ui.statusHint.textContent = view.statusHint || "";
    }
    if (ui.reasonRow) {
      ui.reasonRow.hidden = !view.isCancelled || !view.cancellationReason;
      if (ui.reason) ui.reason.textContent = view.cancellationReason;
    }
  }

  function paintEdit(ui) {
    var api = form();
    if (!api || !edit) return;
    var view = viewFrom(current.appointment, current.lineId);
    ui.editClient.innerHTML = clientHtml(view);
    ui.editLocation.textContent = view.locationLabel;
    ui.dateIn.value = edit.dateKey || "";
    if (document.activeElement !== ui.notesIn) ui.notesIn.value = edit.notes || "";
    var active = document.activeElement;
    if (active && active.hasAttribute) {
      if (active.hasAttribute("data-ff-service-q")) editUi.serviceQ = active.value;
      if (active.hasAttribute("data-ff-provider-q")) editUi.providerQ = active.value;
    }
    if (ui.lines && typeof api.createLinesHtml === "function") {
      ui.lines.innerHTML = api.createLinesHtml(edit, providersForEdit(edit), editUi);
    }
    if (ui.addRow) {
      ui.addRow.hidden = !(edit.lines || []).some(function (line) { return line && line.serviceId; });
    }
    var lineError = !!(edit.error && edit.errorLineKey);
    var unresolvedGap = typeof api.unresolvedGaps === "function" && api.unresolvedGaps(edit).length > 0;
    var providerClash = typeof api.findProviderOverlaps === "function" && api.findProviderOverlaps(edit).length > 0;
    var clashMsg = typeof api.providerOverlapMessage === "function" ? api.providerOverlapMessage(edit) : "";
    ui.error.hidden = (!edit.error && !unresolvedGap && !providerClash) || lineError;
    ui.error.textContent = lineError ? "" : (edit.error || (providerClash ? clashMsg : (unresolvedGap ? "Choose whether to keep the gap or make the times consecutive." : "")));
    ui.save.disabled = !api.canSave(edit) || !!edit.saving || unresolvedGap || providerClash;
    ui.save.textContent = edit.saving ? "Saving…" : "Save Changes";
    if (active && active.hasAttribute && ui.root) {
      var sel = null;
      if (active.hasAttribute("data-ff-service-q")) sel = ui.root.querySelector("[data-ff-service-q]");
      if (active.hasAttribute("data-ff-provider-q")) sel = ui.root.querySelector("[data-ff-provider-q]");
      if (active.hasAttribute("data-ff-guest-name")) {
        sel = ui.root.querySelector('[data-ff-guest-name][data-ff-line="' + (active.getAttribute("data-ff-line") || "") + '"]');
      }
      if (sel) {
        sel.focus();
        try { sel.setSelectionRange(sel.value.length, sel.value.length); } catch (_) {}
      }
    }
  }

  function paint() {
    var ui = els();
    if (!ui.root || !current || !current.appointment) return;
    var editing = mode === "edit" && edit;
    var confirming = mode === "cancel";
    var cancelled = trim(current.appointment.status) === "cancelled";
    ui.title.textContent = editing ? "Edit Appointment" : "Appointment Details";
    ui.view.hidden = !!editing;
    ui.edit.hidden = !editing;
    ui.footView.hidden = !!editing || confirming;
    ui.footEdit.hidden = !editing;
    if (ui.confirm) ui.confirm.hidden = !confirming;
    if (ui.cancelBtn) ui.cancelBtn.hidden = cancelled || trim(current.appointment.status) === "completed";
    if (ui.statusActs) {
      var acts = !cancelled && !editing && !confirming ? statusActions(current.appointment.status) : [];
      ui.statusActs.innerHTML = acts.map(function (act, index) {
        var main = index === 0;
        return '<button type="button" class="' + (main ? "ff-apd-primary" : "ff-apd-ghost") +
          '" data-ff-apd-act="' + escapeHtml(act.id) + '" data-ff-apd-next="' + escapeHtml(act.next) + '"' +
          (statusSaving ? " disabled" : "") + ">" +
          escapeHtml(statusSaving ? "Saving…" : act.label) +
          "</button>";
      }).join("");
    }
    if (ui.editBtn) ui.editBtn.hidden = cancelled;
    if (ui.closeCancelled) ui.closeCancelled.hidden = !cancelled;
    if (ui.confirmGo) {
      ui.confirmGo.disabled = !!cancelling;
      ui.confirmGo.textContent = cancelling ? "Cancelling…" : "Cancel Appointment";
    }
    if (ui.confirmKeep) ui.confirmKeep.disabled = !!cancelling;
    paintView(ui, viewFrom(current.appointment, current.lineId));
    if (editing) paintEdit(ui);
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && (!document.getElementById("ffApdEdit") || !document.getElementById("ffApdCancel") || !document.getElementById("ffApdLines") || !document.getElementById("ffApdStatusActs") || !document.getElementById("ffApdAddRow"))) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return existing;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-apd";
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffApdTitle");
    aside.setAttribute("aria-hidden", "true");
    aside.hidden = true;
    aside.innerHTML =
      '<header class="ff-apd-head">' +
        '<h2 id="ffApdTitle">Appointment Details</h2>' +
        '<button type="button" class="ff-apd-x" data-ff-apd-act="close" aria-label="Close">×</button>' +
      "</header>" +
      '<div class="ff-apd-body">' +
        '<div id="ffApdView">' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Client</span><div id="ffApdClient"></div></div>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Services</span><div id="ffApdServices"></div></div>' +
          '<div class="ff-apd-total"><span>Total</span><strong id="ffApdTotal"></strong></div>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Date</span><div id="ffApdDate" class="ff-apd-value"></div></div>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Location</span><div id="ffApdLocation" class="ff-apd-value"></div></div>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Notes</span><div id="ffApdNotes" class="ff-apd-notes"></div></div>' +
          '<div id="ffApdStatusRow" class="ff-apd-field"><span class="ff-apd-label">Status</span><div id="ffApdStatus" class="ff-apd-status"></div><p id="ffApdStatusHint" class="ff-apd-status-hint" hidden></p></div>' +
          '<div id="ffApdReasonRow" class="ff-apd-field" hidden><span class="ff-apd-label">Cancellation reason</span><div id="ffApdReason" class="ff-apd-notes"></div></div>' +
        "</div>" +
        '<div id="ffApdEdit" hidden>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Client</span><div id="ffApdEditClient"></div></div>' +
          '<div class="ff-apd-field"><span class="ff-apd-label">Location</span><div id="ffApdEditLocation" class="ff-apd-value"></div></div>' +
          '<label class="ff-appt-field"><span>Date</span><input id="ffApdDateIn" type="date"></label>' +
          '<div class="ff-appt-field"><span>Services</span><div id="ffApdLines" class="ff-appt-svcs"></div>' +
            '<div class="ff-appt-add-row" id="ffApdAddRow" hidden>' +
              '<button type="button" class="ff-appt-add-line" data-ff-apd-act="add-line">+ Add another service</button>' +
              '<button type="button" class="ff-appt-add-line" data-ff-apd-act="add-guest">+ Add a guest</button>' +
            "</div>" +
          "</div>" +
          '<label class="ff-appt-field"><span>Notes</span><textarea id="ffApdNotesIn" rows="3" maxlength="2000" placeholder="Add a note..."></textarea></label>' +
          '<div id="ffApdError" class="ff-apd-error" hidden></div>' +
        "</div>" +
        '<div id="ffApdCancel" class="ff-apd-confirm" hidden>' +
          "<h3>Cancel appointment?</h3>" +
          "<p>This will remove the appointment from the active calendar, but it will remain in the client's appointment history.</p>" +
          '<label class="ff-appt-field"><span>Cancellation reason (optional)</span><textarea id="ffApdCancelReason" rows="2" maxlength="2000"></textarea></label>' +
          '<div id="ffApdCancelError" class="ff-apd-error" hidden></div>' +
          '<div class="ff-apd-confirm-actions">' +
            '<button type="button" class="ff-apd-ghost" id="ffApdKeep" data-ff-apd-act="keep">Keep Appointment</button>' +
            '<button type="button" class="ff-apd-danger" id="ffApdConfirmCancel" data-ff-apd-act="confirm-cancel">Cancel Appointment</button>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<footer id="ffApdFootView" class="ff-apd-foot">' +
        '<button type="button" class="ff-apd-danger-text" id="ffApdCancelBtn" data-ff-apd-act="ask-cancel">Cancel Appointment</button>' +
        '<button type="button" class="ff-apd-ghost" id="ffApdCloseCancelled" data-ff-apd-act="close" hidden>Close</button>' +
        '<div class="ff-apd-foot-acts">' +
          '<div id="ffApdStatusActs" class="ff-apd-status-acts"></div>' +
          '<button type="button" class="ff-apd-ghost" id="ffApdEditBtn" data-ff-apd-act="edit">Edit Appointment</button>' +
        "</div>" +
      "</footer>" +
      '<footer id="ffApdFootEdit" class="ff-apd-foot" hidden>' +
        '<button type="button" class="ff-apd-ghost" data-ff-apd-act="cancel-edit">Cancel</button>' +
        '<button type="button" class="ff-apd-primary" data-ff-apd-act="save" id="ffApdSave" disabled>Save Changes</button>' +
      "</footer>";
    host().appendChild(aside);
    bind(aside);
    return aside;
  }

  function visibleDateKey() {
    var st = window.ffBookingCalState;
    return st && typeof st.getSelectedDateKey === "function" ? String(st.getSelectedDateKey() || "") : "";
  }

  function askCancel() {
    if (!current || !current.appointment || current.appointment.status === "cancelled") return;
    if (mode === "edit") return;
    mode = "cancel";
    cancelling = false;
    var ui = els();
    if (ui.confirmReason && document.activeElement !== ui.confirmReason) ui.confirmReason.value = "";
    if (ui.confirmError) {
      ui.confirmError.hidden = true;
      ui.confirmError.textContent = "";
    }
    paint();
    placeLive();
    setTimeout(function () {
      if (ui.confirmReason) ui.confirmReason.focus();
    }, 20);
  }

  function keepAppointment() {
    if (cancelling) return;
    mode = "view";
    paint();
    placeLive();
  }

  async function confirmCancel() {
    if (!current || !current.appointment || cancelling) return;
    if (current.appointment.status === "cancelled") {
      close();
      return;
    }
    var api = repo();
    if (!api || typeof api.cancelAppointment !== "function") return;
    var ui = els();
    var reason = ui.confirmReason ? ui.confirmReason.value : "";
    cancelling = true;
    if (ui.confirmError) {
      ui.confirmError.hidden = true;
      ui.confirmError.textContent = "";
    }
    paint();
    var result;
    try {
      result = await api.cancelAppointment(current.appointment.appointmentId, reason);
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "This appointment could not be cancelled." };
    }
    cancelling = false;
    if (!result || !result.ok) {
      if (ui.confirmError) {
        ui.confirmError.hidden = false;
        ui.confirmError.textContent = (result && result.error) || "This appointment could not be cancelled.";
      }
      paint();
      placeLive();
      return;
    }
    close();
  }

  async function setVisitStatus(nextStatus) {
    if (!current || !current.appointment || statusSaving) return;
    var next = trim(nextStatus);
    var from = trim(current.appointment.status);
    if (!next || from === "cancelled") return;
    if (next === "completed") {
      var checkout = window.ffBookingSalesCheckout;
      if (checkout && typeof checkout.open === "function") {
        checkout.open({
          locationId: current.appointment.locationId,
          appointment: current.appointment
        });
        close();
        return;
      }
    }
    var flow = statusApi();
    if (flow && typeof flow.canAdvanceTo === "function" && !flow.canAdvanceTo(from, next)) return;
    var api = repo();
    if (!api || typeof api.updateAppointment !== "function") return;
    statusSaving = true;
    paint();
    var result;
    try {
      result = await api.updateAppointment(current.appointment.appointmentId, { status: next });
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "This status could not be updated." };
    }
    statusSaving = false;
    if (!result || !result.ok) {
      if (window.ffToast && typeof window.ffToast.show === "function") {
        window.ffToast.show((result && result.error) || "This status could not be updated.", { variant: "error", durationMs: 3200 });
      }
      paint();
      return;
    }
    current.appointment = result.appointment || Object.assign({}, current.appointment, { status: next });
    mode = "view";
    paint();
    placeLive();
  }

  async function enterEdit() {
    var api = form();
    if (!api || !current || !current.appointment) return;
    if (current.appointment.status === "cancelled") return;
    var loc = current.appointment.locationId;
    var lines = (current.appointment.serviceLines || []).map(function (line) {
      return {
        lineId: line.lineId,
        providerId: line.providerId,
        serviceId: line.serviceId,
        serviceName: line.serviceNameSnapshot,
        durationMinutes: line.durationMinutes,
        price: line.priceSnapshot,
        startMin: minutesOf(line.startAt, loc),
        guestKey: line.guestKey,
        guestName: line.guestName,
        requested: !!line.requested
      };
    });
    edit = api.editStateFrom({
      appointmentId: current.appointment.appointmentId,
      clientId: current.appointment.clientId,
      locationId: loc,
      dateKey: current.appointment.dateKey,
      notes: current.appointment.notes,
      lines: lines
    });
    await api.refreshServices(edit);
    (edit.lines || []).forEach(function (line) {
      if (!line.originalServiceId) return;
      var snapshot = {
        id: line.originalServiceId,
        name: line.originalServiceName || "Service",
        durationMinutes: line.storedDurationMinutes,
        price: line.storedPrice || 0,
        raw: {
          durationMinutes: line.storedDurationMinutes,
          defaultPrice: line.storedPrice || 0
        }
      };
      if (!line.service) {
        line.serviceId = line.originalServiceId;
        line.service = snapshot;
        line.capabilityMessage = "This service is not available with this provider.";
      }
      if (line.service && !(line.services || []).some(function (row) { return row.id === line.originalServiceId; })) {
        line.services = [line.service].concat(line.services || []);
      }
    });
    api.derive(edit);
    resetEditUi();
    mode = "edit";
    paint();
    placeLive();
  }

  function cancelEdit() {
    mode = "view";
    edit = null;
    resetEditUi();
    paint();
    placeLive();
  }

  async function saveEdit() {
    var api = form();
    if (!api || !edit || edit.saving || !api.canSave(edit)) return;
    edit.saving = true;
    edit.error = "";
    paint();
    var result = await api.update(edit);
    paint();
    if (!result || !result.ok) {
      placeLive();
      return;
    }
    current.appointment = result.appointment;
    current.lineId = (pickLine(result.appointment, current.lineId) || {}).lineId || current.lineId;
    var savedKey = trim(result.appointment && result.appointment.dateKey);
    mode = "view";
    edit = null;
    resetEditUi();
    if (savedKey && savedKey !== visibleDateKey()) {
      close();
      return;
    }
    paint();
    placeLive();
  }

  function requestClose() {
    if (mode === "cancel") {
      keepAppointment();
      return;
    }
    if (mode === "edit" && form() && edit && form().isEditDirty(edit)) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    close();
  }

  function closeSiblingDrawers() {
    try {
      var drawer = window.ffBookingAppointmentDrawer;
      if (drawer && typeof drawer.hasUnsavedWork === "function" && drawer.hasUnsavedWork()) {
        if (!window.confirm("Discard this unsaved appointment?")) return false;
      }
      if (drawer && drawer.forceClose) drawer.forceClose();
    } catch (_) {}
    try {
      if (window.ffBookingClientsOptions && window.ffBookingClientsOptions.forceClose) {
        window.ffBookingClientsOptions.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientProfile && window.ffBookingClientProfile.forceClose) {
        window.ffBookingClientProfile.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientsDrawer && window.ffBookingClientsDrawer.forceClose) {
        window.ffBookingClientsDrawer.forceClose();
      }
    } catch (_) {}
    return true;
  }

  function placeLive() {
    var api = live();
    var root = document.getElementById(ROOT_ID);
    if (api && root) api.place(root);
  }

  function restoreLive() {
    if (live()) live().restore();
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function close() {
    var ui = els();
    current = null;
    mode = "view";
    edit = null;
    cancelling = false;
    statusSaving = false;
    if (ui.root) {
      ui.root.hidden = true;
      ui.root.classList.remove("is-open");
      ui.root.setAttribute("aria-hidden", "true");
    }
    restoreLive();
  }

  function forceClose() {
    close();
  }

  async function resolveAppointment(appointmentId) {
    var id = trim(appointmentId);
    var cached = calAppts() && typeof calAppts().getCachedById === "function"
      ? calAppts().getCachedById(id)
      : null;
    if (cached && trim(cached.appointmentId) === id) return cached;
    if (repo() && typeof repo().getAppointmentById === "function") {
      try { return await repo().getAppointmentById(id); } catch (_) { return null; }
    }
    return null;
  }

  async function open(spec) {
    var appointmentId = trim(spec && spec.appointmentId);
    if (!appointmentId || !canOpen()) return;
    if (closeSiblingDrawers() === false) return;
    var appointment = await resolveAppointment(appointmentId);
    if (!appointment || trim(appointment.appointmentId) !== appointmentId) return;
    current = {
      appointment: appointment,
      lineId: trim(spec && spec.lineId)
    };
    mode = "view";
    edit = null;
    cancelling = false;
    statusSaving = false;
    ensureDom();
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
    ui.root.setAttribute("aria-hidden", "false");
    paint();
    placeLive();
    requestAnimationFrame(placeLive);
  }

  function bind(root) {
    root.addEventListener("click", function (ev) {
      var api = form();
      var remove = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line-act='remove']") : null;
      if (remove && mode === "edit" && api && edit) {
        ev.preventDefault();
        edit = api.removeLine(edit, remove.getAttribute("data-ff-line"));
        resetEditUi();
        paint();
        return;
      }
      var gapAct = ev.target && ev.target.closest
        ? ev.target.closest("[data-ff-line-act='keep-gap'], [data-ff-line-act='close-gap']")
        : null;
      if (gapAct && mode === "edit" && api && edit) {
        ev.preventDefault();
        var gapKind = gapAct.getAttribute("data-ff-line-act");
        if (gapKind === "keep-gap") {
          if (typeof api.keepGap === "function") {
            edit = api.keepGap(edit, gapAct.getAttribute("data-ff-gap-sig"));
          }
        } else if (typeof api.closeGap === "function") {
          edit = api.closeGap(edit, gapAct.getAttribute("data-ff-line"));
        }
        paint();
        return;
      }
      var pickerAct = ev.target && ev.target.closest ? ev.target.closest("[data-ff-appt-act]") : null;
      if (pickerAct && mode === "edit" && api && edit) {
        var pickerName = pickerAct.getAttribute("data-ff-appt-act");
        if (pickerName === "open-service-picker") {
          editUi.servicePickerKey = pickerAct.getAttribute("data-ff-line") || "";
          editUi.providerPickerKey = "";
          editUi.serviceQ = "";
          paint();
          return;
        }
        if (pickerName === "open-provider-picker") {
          editUi.providerPickerKey = pickerAct.getAttribute("data-ff-line") || "";
          editUi.servicePickerKey = "";
          editUi.providerQ = "";
          paint();
          return;
        }
        if (pickerName === "toggle-service-cat") {
          var cat = pickerAct.getAttribute("data-ff-cat") || "";
          if (!cat) return;
          if (!editUi.expandedCats) editUi.expandedCats = {};
          editUi.expandedCats[cat] = !editUi.expandedCats[cat];
          var group = pickerAct.closest(".ff-appt-picker-group");
          if (group) group.classList.toggle("is-collapsed", !editUi.expandedCats[cat]);
          pickerAct.setAttribute("aria-expanded", editUi.expandedCats[cat] ? "true" : "false");
          return;
        }
        if (pickerName === "toggle-request" && typeof api.setLineRequested === "function") {
          edit = api.setLineRequested(edit, pickerAct.getAttribute("data-ff-line"));
          paint();
          return;
        }
        if (pickerName === "pick-service") {
          edit = api.setLineService(edit, pickerAct.getAttribute("data-ff-line"), pickerAct.getAttribute("data-ff-service"));
          editUi.servicePickerKey = "";
          editUi.serviceQ = "";
          paint();
          return;
        }
        if (pickerName === "pick-provider") {
          api.setLineProvider(edit, pickerAct.getAttribute("data-ff-line"), pickerAct.getAttribute("data-ff-provider")).then(function (next) {
            edit = next;
            editUi.providerPickerKey = "";
            editUi.providerQ = "";
            paint();
          });
          return;
        }
      }
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-apd-act]") : null;
      if (!act) {
        if (
          mode === "edit" &&
          (editUi.servicePickerKey || editUi.providerPickerKey) &&
          ev.target.closest &&
          !ev.target.closest(".ff-appt-picker, .ff-appt-search-row, .ff-appt-chip, .ff-appt-card-name")
        ) {
          editUi.servicePickerKey = "";
          editUi.providerPickerKey = "";
          paint();
        }
        return;
      }
      var name = act.getAttribute("data-ff-apd-act");
      if (name === "close") requestClose();
      else if (name === "edit") enterEdit();
      else if (name === "cancel-edit") cancelEdit();
      else if (name === "save") saveEdit();
      else if ((name === "add-line" || name === "add-guest") && mode === "edit" && api && edit) {
        if (name === "add-guest" && typeof api.addGuest === "function") edit = api.addGuest(edit);
        else {
          var last = edit.lines && edit.lines[edit.lines.length - 1];
          if (!(last && !last.serviceId)) edit = api.addLine(edit);
        }
        last = edit.lines && edit.lines[edit.lines.length - 1];
        editUi.servicePickerKey = last ? last.key : "";
        editUi.providerPickerKey = "";
        editUi.serviceQ = "";
        if (last && last.providerId && typeof api.setLineProvider === "function") {
          api.setLineProvider(edit, last.key, last.providerId).then(function (next) {
            edit = next;
            paint();
          });
        }
        paint();
      } else if (name === "ask-cancel") askCancel();
      else if (act.getAttribute("data-ff-apd-next")) setVisitStatus(act.getAttribute("data-ff-apd-next"));
      else if (name === "keep") keepAppointment();
      else if (name === "confirm-cancel") confirmCancel();
    });
    root.addEventListener("input", function (ev) {
      if (mode !== "edit" || !edit || !form()) return;
      var api = form();
      if (ev.target.id === "ffApdNotesIn") {
        edit.notes = ev.target.value;
        edit.error = "";
        var ui = els();
        if (ui.error) {
          ui.error.hidden = true;
          ui.error.textContent = "";
        }
        if (ui.save) {
          ui.save.disabled = !api.canSave(edit) || !!edit.saving;
          ui.save.setAttribute("aria-disabled", ui.save.disabled ? "true" : "false");
        }
        return;
      }
      if (ev.target.hasAttribute && ev.target.hasAttribute("data-ff-service-q")) {
        editUi.serviceQ = ev.target.value;
        paint();
        return;
      }
      if (ev.target.hasAttribute && ev.target.hasAttribute("data-ff-provider-q")) {
        editUi.providerQ = ev.target.value;
        paint();
        return;
      }
      if (ev.target.hasAttribute && ev.target.hasAttribute("data-ff-guest-name") && api) {
        var guestWrap = ev.target.closest("[data-ff-line]");
        edit = api.setLineGuestName(edit, ev.target.getAttribute("data-ff-line") || (guestWrap && guestWrap.getAttribute("data-ff-line")), ev.target.value);
      }
    });
    root.addEventListener("change", async function (ev) {
      var api = form();
      if (mode !== "edit" || !api || !edit) return;
      var field = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line-field]") : null;
      var wrap = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line]") : null;
      if (field && wrap) {
        var key = wrap.getAttribute("data-ff-line");
        var kind = field.getAttribute("data-ff-line-field");
        if (kind === "service") edit = api.setLineService(edit, key, ev.target.value);
        else if (kind === "provider") edit = await api.setLineProvider(edit, key, ev.target.value);
        else if (kind === "start") edit = api.setLineStart(edit, key, ev.target.value);
        else return;
      } else if (ev.target.id === "ffApdDateIn") {
        edit = api.setDate(edit, ev.target.value);
      } else {
        return;
      }
      paint();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !isOpen()) return;
    if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
    if (document.getElementById("ffLiveDeskPanel") && document.getElementById("ffLiveDeskPanel").classList.contains("is-open")) return;
    ev.preventDefault();
    if (mode === "edit") {
      if (editUi.servicePickerKey || editUi.providerPickerKey) {
        editUi.servicePickerKey = "";
        editUi.providerPickerKey = "";
        paint();
        return;
      }
      cancelEdit();
    }
    else if (mode === "cancel") keepAppointment();
    else close();
  });

  window.addEventListener("resize", function () {
    if (isOpen()) placeLive();
  });

  document.addEventListener("ff-active-location-changed", function () {
    if (isOpen()) close();
  });

  window.ffBookingAppointmentDetails = {
    open: open,
    close: close,
    forceClose: forceClose,
    isOpen: isOpen,
    viewFrom: viewFrom,
    getMode: function () { return mode; },
    getEditState: function () { return edit; },
    getCurrentId: function () {
      return current && current.appointment ? current.appointment.appointmentId : "";
    }
  };
})();
