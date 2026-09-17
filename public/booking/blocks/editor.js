/**
 * Lightweight Time Block create/edit panel.
 * Provider, location, and date stay fixed in this first version.
 * Changing only reason or note must keep the stored start/end/duration.
 */
(function () {
  var EDITOR_ID = "ffBookingBlockEditor";
  var current = null;
  var bound = false;
  var openedAt = 0;
  var saving = false;

  function model() { return window.ffBookingBlockModel || null; }
  function seriesModel() { return window.ffBookingBlockSeriesModel || null; }
  function recurrenceUi() { return window.ffBookingBlockEditorRecurrence || null; }
  function cache() { return window.ffBookingCalBlocks || null; }
  function repo() { return window.ffBookingBlocks || null; }
  function drop() { return window.ffBookingCalDrop || null; }
  function time() { return window.ffBookingTime || null; }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatMinutes(total) {
    var api = model();
    if (api && typeof api.formatMinutes === "function") return api.formatMinutes(total);
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  function formatTimeRange(startMin, endMin) {
    var api = model();
    if (api && typeof api.formatTimeRange === "function") return api.formatTimeRange(startMin, endMin);
    return formatMinutes(startMin) + " – " + formatMinutes(endMin);
  }

  function formatDate(dateKey) {
    var tm = time();
    if (tm && typeof tm.formatDisplayDate === "function") return tm.formatDisplayDate(dateKey);
    return dateKey;
  }

  function providerName(providerId) {
    var dt = window.ffBookingCalData;
    var st = window.ffBookingCalState;
    var id = trim(providerId);
    var list = [];
    try {
      if (st && typeof st.getEmployees === "function") list = st.getEmployees() || [];
    } catch (_) {}
    var emp = (list || []).find(function (row) {
      return row && (row.id === id || row.staffId === id);
    });
    if (emp && dt && typeof dt.displayNameOf === "function") return dt.displayNameOf(emp);
    if (emp) return trim(emp.displayName || emp.name || emp.firstName) || "Provider";
    return "Provider";
  }

  function toast(message, variant) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: variant || "error", durationMs: 3200 });
    }
  }

  function reasons() {
    var api = model();
    return (api && api.REASONS) || ["lunch", "break", "meeting", "training", "personal", "other"];
  }

  function reasonLabel(reason) {
    var api = model();
    if (api && typeof api.labelForReason === "function") return api.labelForReason(reason);
    var cacheApi = cache();
    if (cacheApi && typeof cacheApi.labelForReason === "function") return cacheApi.labelForReason(reason);
    return "Other";
  }

  function presetDurations() {
    var api = model();
    return ((api && api.DURATIONS) || [15, 30, 45, 60, 90, 120]).slice();
  }

  function isPresetDuration(mins) {
    return presetDurations().indexOf(Number(mins)) !== -1;
  }

  function timeOptions(selected, fromMin, toMin) {
    var start = Number.isFinite(Number(fromMin)) ? Number(fromMin) : 6 * 60;
    var end = Number.isFinite(Number(toMin)) ? Number(toMin) : 22 * 60;
    var chosen = Number(selected);
    var html = [];
    var min;
    if (Number.isFinite(chosen) && chosen > end) end = chosen;
    for (min = start; min <= end; min += 15) {
      html.push('<option value="' + min + '"' + (min === chosen ? " selected" : "") + ">" +
        escapeHtml(formatMinutes(min)) + "</option>");
    }
    if (Number.isFinite(chosen) && chosen > start - 15 && (chosen - start) % 15 !== 0) {
      html.push('<option value="' + chosen + '" selected>' + escapeHtml(formatMinutes(chosen)) + "</option>");
    }
    return html.join("");
  }

  function startOptions(selected) {
    return timeOptions(selected, 6 * 60, 22 * 60);
  }

  function endOptions(startMin, selectedEnd) {
    var first = Number(startMin) + 15;
    if (!Number.isFinite(first)) first = 6 * 60 + 15;
    return timeOptions(selectedEnd, first, 23 * 60);
  }

  function durationOptions(duration) {
    var mins = Number(duration);
    var custom = !isPresetDuration(mins);
    return presetDurations().map(function (value) {
      return '<option value="' + value + '"' + (!custom && value === mins ? " selected" : "") + ">" +
        value + " min</option>";
    }).join("") + '<option value="custom"' + (custom ? " selected" : "") + ">Custom</option>";
  }

  function durationFromState(state) {
    var startMin = Number(state && state.startMin);
    var endMin = Number(state && state.endMin);
    if (Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin) {
      return endMin - startMin;
    }
    var explicit = Number(state && state.durationMinutes);
    if (explicit > 0) return explicit;
    return 30;
  }

  function notePlaceholder(reason) {
    return reason === "other" ? "What is this Time Block for?" : "Optional";
  }

  function syncNotePlaceholder(el, reason) {
    var noteEl = el && el.querySelector("[name='ff-block-note']");
    if (!noteEl) return;
    noteEl.placeholder = notePlaceholder(reason || selectedReason(el));
  }

  function specFromState(state) {
    var api = model();
    var startMin = Number(state && state.startMin);
    var duration = durationFromState(state);
    var raw = {
      blockId: state && state.blockId,
      providerId: state && state.providerId,
      locationId: state && state.locationId,
      dateKey: state && state.dateKey,
      startMin: startMin,
      endMin: startMin + duration,
      reason: state && state.reason,
      note: state && state.note,
      label: state && state.label,
      flexibilityMode: state && state.flexibilityMode,
      preferredStartMin: state && state.preferredStartMin != null ? state.preferredStartMin : startMin,
      earliestStartMin: state && state.earliestStartMin,
      latestEndMin: state && state.latestEndMin,
      requiredDurationMinutes: duration,
      seriesId: state && state.seriesId,
      occurrenceDateKey: state && state.occurrenceDateKey,
      isOccurrence: state && state.isOccurrence,
      isOverride: state && state.isOverride,
      repeatFrequency: state && state.repeatFrequency,
      daysOfWeek: state && state.daysOfWeek,
      startDateKey: state && state.startDateKey,
      endDateKey: state && state.endDateKey
    };
    return api && typeof api.normalize === "function" ? api.normalize(raw) : (cache() && cache().normalize(raw));
  }

  function inspectSave(spec, excludeBlockId) {
    if (!spec) return { ok: false, reason: "invalid", message: "That Time Block is not valid." };
    var dropApi = drop();
    if (dropApi && typeof dropApi.inspectOverlap === "function") {
      var conflict = dropApi.inspectOverlap({
        providerId: spec.providerId,
        dateKey: spec.dateKey,
        locationId: spec.locationId,
        startMin: spec.startMin,
        durationMinutes: spec.endMin - spec.startMin
      });
      if (conflict && conflict.ok === false) return conflict;
    }
    if (cache() && typeof cache().overlaps === "function"
        && cache().overlaps(spec.dateKey, spec.locationId, spec.providerId, spec.startMin, spec.endMin, excludeBlockId)) {
      return {
        ok: false,
        reason: "block_conflict",
        message: "This provider already has an overlapping Time Block."
      };
    }
    return { ok: true, spec: spec };
  }

  function selectedReason(el) {
    var chip = el && el.querySelector("[data-ff-block-reason][aria-checked='true']");
    if (!chip) chip = el && el.querySelector("[data-ff-block-reason].is-selected");
    var raw = chip ? chip.getAttribute("data-ff-block-reason") : (current && current.reason);
    var api = model();
    if (api && typeof api.normalizeReason === "function") return api.normalizeReason(raw);
    return trim(raw).toLowerCase() || "lunch";
  }

  function selectReason(reason) {
    var api = model();
    var key = api && typeof api.normalizeReason === "function" ? api.normalizeReason(reason) : trim(reason).toLowerCase();
    if (!current || !key) return null;
    current.reason = key;
    var el = document.getElementById(EDITOR_ID);
    if (el) {
      el.querySelectorAll("[data-ff-block-reason]").forEach(function (chip) {
        var on = chip.getAttribute("data-ff-block-reason") === key;
        chip.classList.toggle("is-selected", on);
        chip.setAttribute("aria-checked", on ? "true" : "false");
      });
      syncNotePlaceholder(el, key);
    }
    return current.reason;
  }

  function readForm(el) {
    if (!el || !current) return null;
    var startEl = el.querySelector("[name='ff-block-start']");
    var durEl = el.querySelector("[name='ff-block-duration']");
    var endEl = el.querySelector("[name='ff-block-end']");
    var noteEl = el.querySelector("[name='ff-block-note']");
    var rec = recurrenceUi() && typeof recurrenceUi().read === "function"
      ? recurrenceUi().read(el, current)
      : {};
    var startMin = startEl ? Number(startEl.value) : current.startMin;
    var custom = !!(durEl && durEl.value === "custom");
    var spec = Object.assign({
      blockId: current.blockId,
      providerId: current.providerId,
      locationId: current.locationId,
      dateKey: current.dateKey,
      startMin: startMin,
      reason: selectedReason(el),
      note: noteEl ? noteEl.value : current.note,
      seriesId: current.seriesId,
      occurrenceDateKey: current.occurrenceDateKey || current.dateKey,
      isOccurrence: current.isOccurrence
    }, rec);
    if (custom) {
      spec.endMin = endEl ? Number(endEl.value) : current.endMin;
    } else if (durEl && Number(durEl.value) > 0) {
      spec.durationMinutes = Number(durEl.value);
    } else {
      spec.endMin = current.endMin;
      spec.startMin = Number.isFinite(startMin) ? startMin : current.startMin;
    }
    spec.preferredStartMin = spec.startMin;
    spec.requiredDurationMinutes = (spec.endMin || (spec.startMin + spec.durationMinutes)) - spec.startMin;
    if (spec.flexibilityMode !== "flexible") {
      spec.earliestStartMin = spec.startMin;
      spec.latestEndMin = spec.startMin + spec.requiredDurationMinutes;
    }
    return specFromState(spec);
  }

  function close() {
    current = null;
    saving = false;
    var el = document.getElementById(EDITOR_ID);
    if (el) {
      el.setAttribute("hidden", "");
      el.innerHTML = "";
    }
    document.body.classList.remove("ff-cal-block-editor-open");
  }

  function ensure() {
    var el = document.getElementById(EDITOR_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = EDITOR_ID;
    el.className = "ff-cal-block-editor";
    el.setAttribute("hidden", "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    document.body.appendChild(el);
    return el;
  }

  function render() {
    if (!current) return;
    var el = ensure();
    var duration = Math.max(15, durationFromState(current));
    var isEdit = !!current.blockId;
    var recHtml = recurrenceUi() && typeof recurrenceUi().fieldsHtml === "function"
      ? recurrenceUi().fieldsHtml(current, function (selected, fromMin, toMin) {
        return timeOptions(selected, fromMin, toMin);
      })
      : "";
    el.innerHTML =
      '<div class="ff-cal-block-editor-card">' +
        '<div class="ff-cal-block-editor-head">' +
          "<h2>Time Block</h2>" +
          '<button type="button" class="ff-cal-block-editor-x" data-ff-block-act="close" aria-label="Close">×</button>' +
        "</div>" +
        '<div class="ff-cal-block-editor-facts">' +
          "<p>Provider: " + escapeHtml(providerName(current.providerId)) + "</p>" +
          "<p>Date: " + escapeHtml(formatDate(current.dateKey)) + "</p>" +
          '<p data-ff-block-end>Time: ' + escapeHtml(formatTimeRange(current.startMin, current.endMin)) + "</p>" +
        "</div>" +
        '<div class="ff-cal-block-editor-field">' +
          "<span>Reason</span>" +
          '<div class="ff-cal-block-reasons" role="radiogroup" aria-label="Reason">' +
            reasons().map(function (reason) {
              var on = reason === current.reason;
              return '<button type="button" class="ff-cal-block-reason' + (on ? " is-selected" : "") +
                '" role="radio" aria-checked="' + (on ? "true" : "false") +
                '" data-ff-block-reason="' + escapeHtml(reason) + '">' +
                escapeHtml(reasonLabel(reason)) +
              "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="ff-cal-block-editor-row">' +
          '<label class="ff-cal-block-editor-field">Start' +
            '<select name="ff-block-start">' + startOptions(current.startMin) + "</select>" +
          "</label>" +
          '<label class="ff-cal-block-editor-field">Duration' +
            '<select name="ff-block-duration">' + durationOptions(duration) + "</select>" +
          "</label>" +
        "</div>" +
        '<label class="ff-cal-block-editor-field" data-ff-block-custom-end' +
          (isPresetDuration(duration) ? " hidden" : "") + ">End" +
          '<select name="ff-block-end">' + endOptions(current.startMin, current.endMin) + "</select>" +
        "</label>" +
        recHtml +
        '<label class="ff-cal-block-editor-field">Note' +
          '<input type="text" name="ff-block-note" maxlength="80" placeholder="' +
            escapeHtml(notePlaceholder(current.reason)) + '" value="' +
            escapeHtml(current.note || "") + '">' +
        "</label>" +
        '<div class="ff-cal-block-editor-foot">' +
          (isEdit ? '<button type="button" class="ff-cal-block-editor-delete" data-ff-block-act="delete">Delete Time Block</button>' : "<span></span>") +
          '<button type="button" class="ff-cal-block-editor-save" data-ff-block-act="save">' +
            (isEdit ? "Save" : "Time Block") +
          "</button>" +
        "</div>" +
      "</div>";
    el.removeAttribute("hidden");
    document.body.classList.add("ff-cal-block-editor-open");
    openedAt = Date.now();
    if (recurrenceUi() && typeof recurrenceUi().syncUi === "function") recurrenceUi().syncUi(el);
  }

  function refreshEndLabel(el) {
    var spec = readForm(el);
    var label = el && el.querySelector("[data-ff-block-end]");
    if (!spec || !label) return;
    label.textContent = "Time: " + formatTimeRange(spec.startMin, spec.endMin);
  }

  function syncTimeUi(el) {
    if (!el) return;
    var startEl = el.querySelector("[name='ff-block-start']");
    var durEl = el.querySelector("[name='ff-block-duration']");
    var endWrap = el.querySelector("[data-ff-block-custom-end]");
    var endEl = el.querySelector("[name='ff-block-end']");
    var startMin = startEl ? Number(startEl.value) : (current && current.startMin);
    var custom = !!(durEl && durEl.value === "custom");
    if (endWrap) {
      if (custom) endWrap.removeAttribute("hidden");
      else endWrap.setAttribute("hidden", "");
    }
    if (custom && endEl) {
      var endMin = Number(endEl.value);
      if (!Number.isFinite(endMin) || endMin <= startMin) endMin = startMin + 30;
      endEl.innerHTML = endOptions(startMin, endMin);
    }
    refreshEndLabel(el);
    if (recurrenceUi() && typeof recurrenceUi().syncUi === "function") recurrenceUi().syncUi(el);
    if (recurrenceUi() && typeof recurrenceUi().refreshFlexLabels === "function") {
      recurrenceUi().refreshFlexLabels(el, readForm(el) || current);
    }
  }

  function openCreate(spec) {
    var row = specFromState(Object.assign({
      reason: "lunch",
      durationMinutes: 30
    }, spec || {}));
    if (!row) return null;
    current = {
      blockId: "",
      providerId: row.providerId,
      locationId: row.locationId,
      dateKey: row.dateKey,
      startMin: row.startMin,
      endMin: row.endMin,
      reason: row.reason,
      note: row.note || "",
      label: row.label,
      flexibilityMode: "fixed",
      preferredStartMin: row.startMin,
      earliestStartMin: Math.max(6 * 60, row.startMin - 60),
      latestEndMin: Math.min(23 * 60, row.endMin + 60),
      requiredDurationMinutes: row.endMin - row.startMin,
      repeatFrequency: "none",
      daysOfWeek: [],
      startDateKey: row.dateKey,
      endDateKey: "",
      editScope: "occurrence"
    };
    render();
    return current;
  }

  function openEdit(block) {
    var row = specFromState(block);
    if (!row || !row.blockId) return null;
    var sm = seriesModel();
    var parsed = sm && typeof sm.parseOccurrenceId === "function" ? sm.parseOccurrenceId(row.blockId) : null;
    current = {
      blockId: row.blockId,
      providerId: row.providerId,
      locationId: row.locationId,
      dateKey: row.dateKey,
      startMin: row.startMin,
      endMin: row.endMin,
      reason: row.reason,
      note: row.note || "",
      label: row.label,
      flexibilityMode: row.flexibilityMode || "fixed",
      preferredStartMin: row.preferredStartMin != null ? row.preferredStartMin : row.startMin,
      earliestStartMin: row.earliestStartMin,
      latestEndMin: row.latestEndMin,
      requiredDurationMinutes: row.requiredDurationMinutes || (row.endMin - row.startMin),
      seriesId: row.seriesId || (parsed && parsed.seriesId) || "",
      occurrenceDateKey: row.occurrenceDateKey || (parsed && parsed.dateKey) || row.dateKey,
      isOccurrence: !!(row.isOccurrence || parsed),
      isOverride: !!row.isOverride,
      repeatFrequency: row.repeatFrequency || (parsed ? "daily" : "none"),
      daysOfWeek: Array.isArray(row.daysOfWeek) ? row.daysOfWeek.slice() : [],
      startDateKey: row.startDateKey || row.dateKey,
      endDateKey: row.endDateKey || "",
      editScope: "occurrence"
    };
    render();
    return current;
  }

  async function save() {
    if (saving) return;
    var el = document.getElementById(EDITOR_ID);
    var spec = readForm(el);
    var rec = recurrenceUi() && typeof recurrenceUi().read === "function"
      ? recurrenceUi().read(el, current)
      : {};
    var payload = Object.assign({}, spec, rec, {
      preferredStartMin: spec && spec.startMin,
      durationMinutes: spec ? spec.endMin - spec.startMin : 30,
      requiredDurationMinutes: spec ? spec.endMin - spec.startMin : 30
    });
    var checked = inspectSave(spec, current && current.blockId);
    if (!checked.ok) {
      toast(checked.message || "That time is not available.");
      return;
    }
    var api = repo();
    if (!api) {
      toast("Time Block is not ready.");
      return;
    }
    saving = true;
    try {
      if (current && current.isOccurrence && current.seriesId) {
        if (rec.editScope === "series" && typeof api.updateSeries === "function") {
          await api.updateSeries(current.seriesId, payload);
        } else if (rec.editScope === "future" && typeof api.splitSeriesFrom === "function") {
          await api.splitSeriesFrom(current.seriesId, current.dateKey, payload);
        } else {
          await api.update(current.blockId, payload);
        }
      } else if (current && current.blockId) {
        await api.update(current.blockId, payload);
      } else {
        await api.create(payload);
      }
      close();
    } catch (err) {
      toast((err && err.message) || "Could not save this Time Block.");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!current || !current.blockId || saving) return;
    var el = document.getElementById(EDITOR_ID);
    var rec = recurrenceUi() && typeof recurrenceUi().read === "function"
      ? recurrenceUi().read(el, current)
      : {};
    var api = repo();
    if (!api || typeof api.remove !== "function") return;
    var isSeries = !!(current.isOccurrence && current.seriesId);
    var message = "Delete this Time Block? That time will become available for booking.";
    if (isSeries && rec.editScope === "series") {
      message = "Delete the entire repeating Time Block? Every day in this series will be removed.";
    } else if (isSeries && rec.editScope === "future") {
      message = "Delete this and future occurrences? Earlier days will stay.";
    } else if (isSeries) {
      message = "Delete this Time Block for this date only? Later days will still have it.";
    }
    if (!window.confirm(message)) return;
    saving = true;
    try {
      if (isSeries && rec.editScope === "series" && typeof api.deleteSeries === "function") {
        await api.deleteSeries(current.seriesId);
      } else if (isSeries && rec.editScope === "future" && typeof api.updateSeries === "function") {
        var sm = seriesModel();
        var prev = sm && typeof sm.previousDateKey === "function"
          ? sm.previousDateKey(current.dateKey)
          : current.dateKey;
        if (current.startDateKey === current.dateKey && typeof api.deleteSeries === "function") {
          await api.deleteSeries(current.seriesId);
        } else {
          await api.updateSeries(current.seriesId, Object.assign({}, current, { endDateKey: prev }));
        }
      } else {
        await api.remove(current.blockId);
      }
      close();
    } catch (err) {
      toast((err && err.message) || "Could not delete this Time Block.");
    } finally {
      saving = false;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var el = document.getElementById(EDITOR_ID);
      if (!el || el.hasAttribute("hidden")) return;
      var flexBtn = t.closest("[data-ff-block-flex]");
      if (flexBtn && el.contains(flexBtn)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (recurrenceUi() && typeof recurrenceUi().selectFlex === "function") {
          recurrenceUi().selectFlex(el, flexBtn.getAttribute("data-ff-block-flex"));
        }
        return;
      }
      var reasonBtn = t.closest("[data-ff-block-reason]");
      if (reasonBtn && el.contains(reasonBtn)) {
        ev.preventDefault();
        ev.stopPropagation();
        selectReason(reasonBtn.getAttribute("data-ff-block-reason"));
        return;
      }
      var act = t.closest("[data-ff-block-act]");
      if (act && el.contains(act)) {
        ev.preventDefault();
        ev.stopPropagation();
        var name = act.getAttribute("data-ff-block-act");
        if (name === "close") close();
        else if (name === "save") save();
        else if (name === "delete") remove();
        return;
      }
      if (t.closest(".ff-cal-block-editor-card")) return;
      if (Date.now() - openedAt < 80) return;
      if (t === el) close();
    }, true);
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var el = document.getElementById(EDITOR_ID);
      if (!el || el.hasAttribute("hidden") || !el.contains(t)) return;
      syncTimeUi(el);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && current) {
        ev.preventDefault();
        close();
      }
    });
  }

  window.ffBookingBlockEditor = {
    openCreate: openCreate,
    openEdit: openEdit,
    close: close,
    isOpen: function () { return !!current; },
    current: function () { return current ? Object.assign({}, current) : null; },
    specFromState: specFromState,
    durationFromState: durationFromState,
    selectReason: selectReason,
    isPresetDuration: isPresetDuration,
    inspectSave: inspectSave,
    formatMinutes: formatMinutes
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
