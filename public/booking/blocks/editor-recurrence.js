/**
 * Repeat + Flexibility fields for the Time Block editor.
 */
(function () {
  function seriesModel() { return window.ffBookingBlockSeriesModel || null; }
  function flexApi() { return window.ffBookingFlexRelocate || null; }

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

  function selectedDays(el) {
    var days = [];
    if (!el) return days;
    el.querySelectorAll("[data-ff-block-day]:checked").forEach(function (box) {
      var n = Number(box.getAttribute("data-ff-block-day"));
      if (Number.isInteger(n) && n >= 0 && n <= 6) days.push(n);
    });
    return days;
  }

  function fieldsHtml(state, timeOptionsFn) {
    var sm = seriesModel();
    var labels = (sm && sm.WEEKDAY_LABELS) || [];
    var freq = trim(state && state.repeatFrequency) || "none";
    var flex = trim(state && state.flexibilityMode) || "fixed";
    var days = Array.isArray(state && state.daysOfWeek) ? state.daysOfWeek : [];
    var startDate = trim(state && state.startDateKey) || trim(state && state.dateKey);
    var endMode = trim(state && state.endDateKey) ? "on" : "never";
    var earliest = Number(state && state.earliestStartMin);
    var latest = Number(state && state.latestEndMin);
    var startMin = Number(state && state.startMin);
    var endMin = Number(state && state.endMin);
    var duration = Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin
      ? endMin - startMin
      : 30;
    if (!Number.isFinite(earliest)) earliest = Math.max(6 * 60, startMin - 60);
    if (!Number.isFinite(latest)) latest = Math.min(22 * 60 + 30, endMin + 60);
    var isOccurrence = !!(state && (state.isOccurrence || (sm && sm.isOccurrenceId && sm.isOccurrenceId(state.blockId))));
    var scope = trim(state && state.editScope) || "occurrence";
    var timeOptions = typeof timeOptionsFn === "function" ? timeOptionsFn : function () { return ""; };
    var daysHtml = labels.map(function (row) {
      var on = days.indexOf(row.value) !== -1 || (freq === "weekdays" && row.value >= 1 && row.value <= 5);
      return '<label class="ff-cal-block-day">' +
        '<input type="checkbox" data-ff-block-day="' + row.value + '"' + (on ? " checked" : "") + ">" +
        escapeHtml(row.label) +
      "</label>";
    }).join("");
    var scopeHtml = isOccurrence
      ? '<div class="ff-cal-block-editor-field">' +
          "<span>Apply to</span>" +
          '<div class="ff-cal-block-scopes" role="radiogroup" aria-label="Apply to">' +
            '<label><input type="radio" name="ff-block-scope" value="occurrence"' +
              (scope === "occurrence" ? " checked" : "") + "> This occurrence</label>" +
            '<label><input type="radio" name="ff-block-scope" value="future"' +
              (scope === "future" ? " checked" : "") + "> This and future</label>" +
            '<label><input type="radio" name="ff-block-scope" value="series"' +
              (scope === "series" ? " checked" : "") + "> Entire series</label>" +
          "</div>" +
        "</div>"
      : "";
    return scopeHtml +
      '<label class="ff-cal-block-editor-field">Repeat' +
        '<select name="ff-block-repeat">' +
          '<option value="none"' + (freq === "none" ? " selected" : "") + ">Does not repeat</option>" +
          '<option value="daily"' + (freq === "daily" ? " selected" : "") + ">Every day</option>" +
          '<option value="weekdays"' + (freq === "weekdays" ? " selected" : "") + ">Weekdays</option>" +
          '<option value="custom"' + (freq === "custom" ? " selected" : "") + ">Custom</option>" +
        "</select>" +
      "</label>" +
      '<div class="ff-cal-block-editor-field" data-ff-block-custom-days' +
        (freq === "custom" ? "" : " hidden") + ">Days" +
        '<div class="ff-cal-block-days">' + daysHtml + "</div>" +
      "</div>" +
      '<div class="ff-cal-block-editor-row" data-ff-block-repeat-range' +
        (freq === "none" ? " hidden" : "") + ">" +
        '<label class="ff-cal-block-editor-field">Repeat starts' +
          '<input type="date" name="ff-block-repeat-start" value="' + escapeHtml(startDate) + '">' +
        "</label>" +
        '<label class="ff-cal-block-editor-field">Repeat ends' +
          '<select name="ff-block-repeat-end-mode">' +
            '<option value="never"' + (endMode === "never" ? " selected" : "") + ">Never</option>" +
            '<option value="on"' + (endMode === "on" ? " selected" : "") + ">On date</option>" +
          "</select>" +
        "</label>" +
      "</div>" +
      '<label class="ff-cal-block-editor-field" data-ff-block-repeat-end' +
        (freq !== "none" && endMode === "on" ? "" : " hidden") + ">End date" +
        '<input type="date" name="ff-block-repeat-end" value="' + escapeHtml(trim(state && state.endDateKey)) + '">' +
      "</label>" +
      '<div class="ff-cal-block-editor-field">' +
        "<span>Flexibility</span>" +
        '<div class="ff-cal-block-flex" role="radiogroup" aria-label="Flexibility">' +
          '<button type="button" class="ff-cal-block-flex-opt' + (flex === "fixed" ? " is-selected" : "") +
            '" data-ff-block-flex="fixed" aria-checked="' + (flex === "fixed" ? "true" : "false") + '">Fixed</button>' +
          '<button type="button" class="ff-cal-block-flex-opt' + (flex === "flexible" ? " is-selected" : "") +
            '" data-ff-block-flex="flexible" aria-checked="' + (flex === "flexible" ? "true" : "false") + '">Flexible</button>' +
        "</div>" +
      "</div>" +
      '<div data-ff-block-flex-fields' + (flex === "flexible" ? "" : " hidden") + ">" +
        '<p class="ff-cal-block-editor-end" data-ff-block-preferred>Preferred time: ' +
          escapeHtml((window.ffBookingBlockModel && window.ffBookingBlockModel.formatTimeRange
            ? window.ffBookingBlockModel.formatTimeRange(startMin, endMin)
            : "") || "") +
        "</p>" +
        '<p class="ff-cal-block-editor-end" data-ff-block-required>Required duration: ' + duration + " min</p>" +
        '<div class="ff-cal-block-editor-row">' +
          '<label class="ff-cal-block-editor-field">Earliest start' +
            '<select name="ff-block-earliest">' + timeOptions(earliest, 6 * 60, 22 * 60) + "</select>" +
          "</label>" +
          '<label class="ff-cal-block-editor-field">Latest end' +
            '<select name="ff-block-latest">' + timeOptions(latest, 6 * 60 + 15, 23 * 60) + "</select>" +
          "</label>" +
        "</div>" +
      "</div>";
  }

  function syncUi(el) {
    if (!el) return;
    var freqEl = el.querySelector("[name='ff-block-repeat']");
    var freq = freqEl ? freqEl.value : "none";
    var daysWrap = el.querySelector("[data-ff-block-custom-days]");
    var rangeWrap = el.querySelector("[data-ff-block-repeat-range]");
    var endModeEl = el.querySelector("[name='ff-block-repeat-end-mode']");
    var endWrap = el.querySelector("[data-ff-block-repeat-end]");
    var flexBtn = el.querySelector("[data-ff-block-flex][aria-checked='true']")
      || el.querySelector("[data-ff-block-flex].is-selected");
    var flex = flexBtn ? flexBtn.getAttribute("data-ff-block-flex") : "fixed";
    var flexFields = el.querySelector("[data-ff-block-flex-fields]");
    if (daysWrap) {
      if (freq === "custom") daysWrap.removeAttribute("hidden");
      else daysWrap.setAttribute("hidden", "");
    }
    if (rangeWrap) {
      if (freq === "none") rangeWrap.setAttribute("hidden", "");
      else rangeWrap.removeAttribute("hidden");
    }
    if (endWrap) {
      if (freq !== "none" && endModeEl && endModeEl.value === "on") endWrap.removeAttribute("hidden");
      else endWrap.setAttribute("hidden", "");
    }
    if (flexFields) {
      if (flex === "flexible") flexFields.removeAttribute("hidden");
      else flexFields.setAttribute("hidden", "");
    }
  }

  function selectFlex(el, mode) {
    var key = trim(mode) === "flexible" ? "flexible" : "fixed";
    if (!el) return key;
    el.querySelectorAll("[data-ff-block-flex]").forEach(function (btn) {
      var on = btn.getAttribute("data-ff-block-flex") === key;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    syncUi(el);
    return key;
  }

  function read(el, current) {
    var sm = seriesModel();
    var freqEl = el && el.querySelector("[name='ff-block-repeat']");
    var startEl = el && el.querySelector("[name='ff-block-repeat-start']");
    var endModeEl = el && el.querySelector("[name='ff-block-repeat-end-mode']");
    var endEl = el && el.querySelector("[name='ff-block-repeat-end']");
    var earliestEl = el && el.querySelector("[name='ff-block-earliest']");
    var latestEl = el && el.querySelector("[name='ff-block-latest']");
    var scopeEl = el && el.querySelector("[name='ff-block-scope']:checked");
    var flexBtn = el && (el.querySelector("[data-ff-block-flex][aria-checked='true']")
      || el.querySelector("[data-ff-block-flex].is-selected"));
    var frequency = sm && typeof sm.normalizeFrequency === "function"
      ? sm.normalizeFrequency(freqEl && freqEl.value)
      : "none";
    var flex = flexBtn && flexBtn.getAttribute("data-ff-block-flex") === "flexible" ? "flexible" : "fixed";
    var days = frequency === "custom" ? selectedDays(el) : (sm ? sm.daysForFrequency(frequency) : []);
    var startDateKey = startEl && startEl.value ? startEl.value : (current && (current.startDateKey || current.dateKey));
    var endDateKey = "";
    if (frequency !== "none" && endModeEl && endModeEl.value === "on" && endEl && endEl.value) {
      endDateKey = endEl.value;
    }
    return {
      repeatFrequency: frequency,
      daysOfWeek: days,
      startDateKey: startDateKey,
      endDateKey: endDateKey,
      flexibilityMode: flex,
      earliestStartMin: earliestEl ? Number(earliestEl.value) : (current && current.earliestStartMin),
      latestEndMin: latestEl ? Number(latestEl.value) : (current && current.latestEndMin),
      editScope: scopeEl ? scopeEl.value : "occurrence"
    };
  }

  function refreshFlexLabels(el, spec) {
    if (!el || !spec) return;
    var preferred = el.querySelector("[data-ff-block-preferred]");
    var required = el.querySelector("[data-ff-block-required]");
    var model = window.ffBookingBlockModel;
    if (preferred && model && typeof model.formatTimeRange === "function") {
      preferred.textContent = "Preferred time: " + model.formatTimeRange(spec.startMin, spec.endMin);
    }
    if (required) {
      required.textContent = "Required duration: " + Math.max(15, spec.endMin - spec.startMin) + " min";
    }
  }

  window.ffBookingBlockEditorRecurrence = {
    fieldsHtml: fieldsHtml,
    syncUi: syncUi,
    selectFlex: selectFlex,
    read: read,
    refreshFlexLabels: refreshFlexLabels
  };
})();
