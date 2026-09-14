/**
 * Lightweight Block Time create/edit panel.
 * Provider, location, and date stay fixed in this first version.
 */
(function () {
  var EDITOR_ID = "ffBookingBlockEditor";
  var current = null;
  var bound = false;
  var openedAt = 0;
  var saving = false;

  function model() { return window.ffBookingBlockModel || null; }
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
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
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

  function durations(includeMin) {
    var api = model();
    var list = ((api && api.DURATIONS) || [15, 30, 45, 60, 90, 120]).slice();
    var extra = Number(includeMin);
    if (extra > 0 && list.indexOf(extra) === -1) {
      list.push(extra);
      list.sort(function (a, b) { return a - b; });
    }
    return list;
  }

  function startOptions(selected) {
    var html = [];
    var min;
    for (min = 6 * 60; min <= 22 * 60; min += 15) {
      html.push('<option value="' + min + '"' + (min === selected ? " selected" : "") + ">" +
        escapeHtml(formatMinutes(min)) + "</option>");
    }
    return html.join("");
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
      label: state && state.label
    };
    return api && typeof api.normalize === "function" ? api.normalize(raw) : (cache() && cache().normalize(raw));
  }

  function inspectSave(spec, excludeBlockId) {
    if (!spec) return { ok: false, reason: "invalid", message: "That block time is not valid." };
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
        message: "This provider already has overlapping block time."
      };
    }
    return { ok: true, spec: spec };
  }

  function readForm(el) {
    if (!el || !current) return null;
    var reasonEl = el.querySelector("[name='ff-block-reason']:checked");
    var startEl = el.querySelector("[name='ff-block-start']");
    var durEl = el.querySelector("[name='ff-block-duration']");
    var noteEl = el.querySelector("[name='ff-block-note']");
    return specFromState({
      blockId: current.blockId,
      providerId: current.providerId,
      locationId: current.locationId,
      dateKey: current.dateKey,
      startMin: startEl ? Number(startEl.value) : current.startMin,
      durationMinutes: durEl ? Number(durEl.value) : (current.endMin - current.startMin),
      reason: reasonEl ? reasonEl.value : current.reason,
      note: noteEl ? noteEl.value : current.note
    });
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
    var duration = Math.max(15, Number(current.endMin) - Number(current.startMin));
    var isEdit = !!current.blockId;
    el.innerHTML =
      '<div class="ff-cal-block-editor-card">' +
        '<div class="ff-cal-block-editor-head">' +
          "<h2>" + (isEdit ? "Edit Block Time" : "Block Time") + "</h2>" +
          '<button type="button" class="ff-cal-block-editor-x" data-ff-block-act="close" aria-label="Close">×</button>' +
        "</div>" +
        '<p class="ff-cal-block-editor-meta">' +
          escapeHtml(providerName(current.providerId)) + " · " +
          escapeHtml(formatDate(current.dateKey)) +
        "</p>" +
        '<div class="ff-cal-block-editor-field">' +
          "<span>Reason</span>" +
          '<div class="ff-cal-block-reasons">' +
            reasons().map(function (reason) {
              return '<label class="ff-cal-block-reason">' +
                '<input type="radio" name="ff-block-reason" value="' + escapeHtml(reason) + '"' +
                (reason === current.reason ? " checked" : "") + ">" +
                escapeHtml(reasonLabel(reason)) +
              "</label>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="ff-cal-block-editor-row">' +
          '<label class="ff-cal-block-editor-field">Start' +
            '<select name="ff-block-start">' + startOptions(current.startMin) + "</select>" +
          "</label>" +
          '<label class="ff-cal-block-editor-field">Duration' +
            '<select name="ff-block-duration">' +
              durations(duration).map(function (mins) {
                return '<option value="' + mins + '"' + (mins === duration ? " selected" : "") + ">" +
                  mins + " min</option>";
              }).join("") +
            "</select>" +
          "</label>" +
        "</div>" +
        '<p class="ff-cal-block-editor-end" data-ff-block-end>' +
          escapeHtml(formatMinutes(current.startMin)) + "–" + escapeHtml(formatMinutes(current.endMin)) +
        "</p>" +
        '<label class="ff-cal-block-editor-field">Note' +
          '<input type="text" name="ff-block-note" maxlength="80" placeholder="Optional" value="' +
            escapeHtml(current.note || "") + '">' +
        "</label>" +
        '<div class="ff-cal-block-editor-foot">' +
          (isEdit ? '<button type="button" class="ff-cal-block-editor-delete" data-ff-block-act="delete">Delete Block</button>' : "<span></span>") +
          '<button type="button" class="ff-cal-block-editor-save" data-ff-block-act="save">' +
            (isEdit ? "Save" : "Block Time") +
          "</button>" +
        "</div>" +
      "</div>";
    el.removeAttribute("hidden");
    document.body.classList.add("ff-cal-block-editor-open");
    openedAt = Date.now();
  }

  function refreshEndLabel(el) {
    var spec = readForm(el);
    var label = el && el.querySelector("[data-ff-block-end]");
    if (!spec || !label) return;
    label.textContent = formatMinutes(spec.startMin) + "–" + formatMinutes(spec.endMin);
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
      label: row.label
    };
    render();
    return current;
  }

  function openEdit(block) {
    var row = specFromState(block);
    if (!row || !row.blockId) return null;
    current = {
      blockId: row.blockId,
      providerId: row.providerId,
      locationId: row.locationId,
      dateKey: row.dateKey,
      startMin: row.startMin,
      endMin: row.endMin,
      reason: row.reason,
      note: row.note || "",
      label: row.label
    };
    render();
    return current;
  }

  async function save() {
    if (saving) return;
    var el = document.getElementById(EDITOR_ID);
    var spec = readForm(el);
    var checked = inspectSave(spec, current && current.blockId);
    if (!checked.ok) {
      toast(checked.message || "That time is not available.");
      return;
    }
    var api = repo();
    if (!api) {
      toast("Block Time is not ready.");
      return;
    }
    saving = true;
    try {
      if (current && current.blockId) {
        await api.update(current.blockId, spec);
      } else {
        await api.create(spec);
      }
      close();
    } catch (err) {
      toast((err && err.message) || "Could not save block time.");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!current || !current.blockId || saving) return;
    if (!window.confirm("Delete this block time? That time will become available for booking.")) return;
    var api = repo();
    if (!api || typeof api.remove !== "function") return;
    saving = true;
    try {
      await api.remove(current.blockId);
      close();
    } catch (err) {
      toast((err && err.message) || "Could not delete block time.");
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
      var act = t.closest("[data-ff-block-act]");
      if (act) {
        ev.preventDefault();
        var name = act.getAttribute("data-ff-block-act");
        if (name === "close") close();
        else if (name === "save") save();
        else if (name === "delete") remove();
        return;
      }
      if (Date.now() - openedAt < 80) return;
      if (!t.closest("#" + EDITOR_ID)) close();
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var el = document.getElementById(EDITOR_ID);
      if (!el || el.hasAttribute("hidden") || !el.contains(t)) return;
      refreshEndLabel(el);
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
    inspectSave: inspectSave,
    formatMinutes: formatMinutes
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
