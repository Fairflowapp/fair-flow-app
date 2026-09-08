/**
 * Booking Sales model. One sale is one checkout ticket.
 * Does not read Firestore. The repository consumes this.
 *
 * Path: salons/{salonId}/sales/{saleId}
 */
(function () {
  var STATUSES = ["open", "closed", "void"];
  var SOURCES = ["appointment", "walk_in", "front_desk"];
  var NOTES_MAX = 2000;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function trimText(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseSpaces(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function normalizeNotes(value) {
    return collapseSpaces(value).slice(0, NOTES_MAX);
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function isStatus(value) {
    return STATUSES.indexOf(trimText(value)) !== -1;
  }

  function isSource(value) {
    return SOURCES.indexOf(trimText(value)) !== -1;
  }

  function statusLabel(value) {
    var key = trimText(value);
    if (key === "closed") return "Closed";
    if (key === "open") return "Open";
    if (key === "void") return "Void";
    return "Closed";
  }

  function saleLabel(sale) {
    var n = Number(sale && sale.saleNumber);
    return "Sale #" + (Number.isFinite(n) && n > 0 ? String(n) : "—");
  }

  function clientName(sale) {
    return collapseSpaces(sale && sale.clientSnapshot && sale.clientSnapshot.displayName) || "Client";
  }

  function itemsFromAppointment(appointment) {
    return (appointment && appointment.serviceLines || []).map(function (line) {
      var row = line && typeof line === "object" ? line : {};
      return {
        lineId: trimText(row.lineId),
        kind: "service",
        name: collapseSpaces(row.serviceNameSnapshot) || "Service",
        serviceId: trimText(row.serviceId),
        providerId: trimText(row.providerId),
        providerName: collapseSpaces(row.providerNameSnapshot),
        amount: Number(row.priceSnapshot) || 0
      };
    }).filter(function (item) { return item.name; });
  }

  function normalizeItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (row) {
      var item = row && typeof row === "object" ? row : {};
      return {
        lineId: trimText(item.lineId),
        kind: trimText(item.kind) || "service",
        name: collapseSpaces(item.name) || "Item",
        serviceId: trimText(item.serviceId),
        providerId: trimText(item.providerId),
        providerName: collapseSpaces(item.providerName),
        amount: Number(item.amount) || 0
      };
    });
  }

  function normalizeTip(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function totalsFromItems(items, tip) {
    var subtotal = (items || []).reduce(function (sum, item) {
      return sum + (Number(item && item.amount) || 0);
    }, 0);
    var tipAmt = normalizeTip(tip);
    return { subtotal: subtotal, tax: 0, tip: tipAmt, total: Math.round((subtotal + tipAmt) * 100) / 100 };
  }

  function fail(code, error) {
    return { ok: false, code: code, error: error || code };
  }

  function normalizeCreate(input) {
    var raw = input && typeof input === "object" ? input : {};
    var locationId = trimText(raw.locationId);
    var clientId = trimText(raw.clientId);
    var status = trimText(raw.status) || "closed";
    var source = trimText(raw.source) || "front_desk";
    var items = normalizeItems(raw.items);
    if (!locationId) return fail("MISSING_LOCATION", "A location is required.");
    if (!clientId) return fail("INVALID_CLIENT", "A client is required.");
    if (!items.length) return fail("INVALID_ITEMS", "Add at least one item.");
    if (!isStatus(status) || status === "void") return fail("INVALID_STATUS", "Invalid sale status.");
    if (!isSource(source)) return fail("INVALID_SOURCE", "Invalid sale source.");
    var totals = totalsFromItems(items, raw.tip);
    var snapshot = raw.clientSnapshot && typeof raw.clientSnapshot === "object" ? raw.clientSnapshot : {};
    return {
      ok: true,
      fields: {
        locationId: locationId,
        clientId: clientId,
        clientSnapshot: {
          displayName: collapseSpaces(snapshot.displayName) || "Client",
          phone: collapseSpaces(snapshot.phone),
          email: trimText(snapshot.email)
        },
        appointmentId: trimText(raw.appointmentId),
        status: status,
        source: source,
        items: items,
        subtotal: totals.subtotal,
        tax: totals.tax,
        tip: totals.tip,
        total: totals.total,
        closedAt: raw.closedAt || null
      }
    };
  }

  function fromAppointment(appointment, extras) {
    if (!appointment || !trimText(appointment.appointmentId)) {
      return fail("INVALID_APPOINTMENT", "An appointment is required.");
    }
    var extra = extras && typeof extras === "object" ? extras : {};
    return normalizeCreate({
      locationId: appointment.locationId,
      clientId: appointment.clientId,
      clientSnapshot: appointment.clientSnapshot,
      appointmentId: appointment.appointmentId,
      status: "closed",
      source: "appointment",
      items: itemsFromAppointment(appointment),
      tip: extra.tip,
      closedAt: appointment.endAt || appointment.startAt || null
    });
  }

  function fromDoc(id, data) {
    var raw = data && typeof data === "object" ? data : {};
    var snapshot = raw.clientSnapshot && typeof raw.clientSnapshot === "object" ? raw.clientSnapshot : {};
    var items = normalizeItems(raw.items);
    var totals = totalsFromItems(items);
    return {
      saleId: String(id || raw.saleId || ""),
      saleNumber: Number(raw.saleNumber) > 0 ? Number(raw.saleNumber) : 0,
      locationId: trimText(raw.locationId),
      clientId: trimText(raw.clientId),
      clientSnapshot: {
        displayName: collapseSpaces(snapshot.displayName),
        phone: collapseSpaces(snapshot.phone),
        email: trimText(snapshot.email)
      },
      appointmentId: trimText(raw.appointmentId),
      status: isStatus(raw.status) ? trimText(raw.status) : "closed",
      source: isSource(raw.source) ? trimText(raw.source) : "front_desk",
      items: items,
      subtotal: Number.isFinite(Number(raw.subtotal)) ? Number(raw.subtotal) : totals.subtotal,
      tax: Number.isFinite(Number(raw.tax)) ? Number(raw.tax) : totals.tax,
      total: Number.isFinite(Number(raw.total)) ? Number(raw.total) : totals.total,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      closedAt: raw.closedAt || raw.createdAt || null,
      createdByUid: trimText(raw.createdByUid),
      createdByStaffId: trimText(raw.createdByStaffId),
      createdByName: collapseSpaces(raw.createdByName),
      notes: normalizeNotes(raw.notes),
      history: normalizeHistory(raw.history),
      method: trimText(raw.method) || "none",
      processor: trimText(raw.processor) || "none",
      channel: trimText(raw.channel) || channelFromSource(raw.source),
      houseDiscount: Number(raw.houseDiscount) > 0 ? Number(raw.houseDiscount) : 0,
      tip: Number(raw.tip) > 0 ? Number(raw.tip) : 0
    };
  }

  function coerceDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") {
      try { return value.toDate(); } catch (_) { return null; }
    }
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDate(value) {
    var date = coerceDate(value);
    if (!date) return "—";
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function") {
      var key = tm.zonedDateKey(date);
      var parts = tm.parseDateKey && key ? tm.parseDateKey(key) : null;
      if (parts) return MONTHS[parts.m - 1] + " " + parts.d;
    }
    return MONTHS[date.getMonth()] + " " + date.getDate();
  }

  function formatMonthYear(value) {
    var date = coerceDate(value);
    if (!date) return "";
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function") {
      var key = tm.zonedDateKey(date);
      var parts = tm.parseDateKey && key ? tm.parseDateKey(key) : null;
      if (parts) return MONTHS[parts.m - 1] + " " + parts.y;
    }
    return MONTHS[date.getMonth()] + " " + date.getFullYear();
  }

  function formatClock(value, locationId) {
    var date = coerceDate(value);
    var tm = window.ffBookingTime;
    if (!date || !tm || typeof tm.zonedMinutes !== "function") return "";
    var min = tm.zonedMinutes(date, locationId);
    if (!Number.isFinite(min)) return "";
    var h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
    var m = ((min % 60) + 60) % 60;
    var suffix = h >= 12 ? "PM" : "AM";
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(m).padStart(2, "0") + " " + suffix;
  }

  function formatWhen(value, locationId) {
    var date = coerceDate(value);
    if (!date) return "—";
    var day = formatDate(value);
    var year = "";
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function") {
      var key = tm.zonedDateKey(date, locationId);
      var parts = tm.parseDateKey && key ? tm.parseDateKey(key) : null;
      if (parts) year = String(parts.y);
    }
    if (!year) year = String(date.getFullYear());
    var clock = formatClock(date, locationId);
    return day + ", " + year + (clock ? " · " + clock : "");
  }

  function clientSinceLabel(value) {
    var month = formatMonthYear(value);
    return month ? "Client since " + month : "";
  }

  function normalizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (row) {
      var item = row && typeof row === "object" ? row : {};
      return {
        type: trimText(item.type),
        at: item.at || null,
        byName: collapseSpaces(item.byName),
        byStaffId: trimText(item.byStaffId),
        byUid: trimText(item.byUid),
        from: collapseSpaces(item.from),
        to: collapseSpaces(item.to),
        fromWhen: item.fromWhen || null,
        fromBy: collapseSpaces(item.fromBy),
        amount: Number(item.amount) || 0,
        previousTotal: Number(item.previousTotal) || 0
      };
    }).filter(function (item) { return !!item.type; });
  }

  function lastCloserName(sale) {
    var list = sale && sale.history ? sale.history : [];
    for (var i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] && list[i].type === "closed" && list[i].byName) return list[i].byName;
    }
    return collapseSpaces(sale && sale.createdByName);
  }

  function historyFromPatch(existing, patch, actor) {
    var sale = existing && typeof existing === "object" ? existing : {};
    var next = patch && typeof patch === "object" ? patch : {};
    var who = collapseSpaces(actor && actor.name) || "Staff";
    var events = [];
    if (next.closedAt != null && next.status !== "open") {
      var fromKey = dateKeyOf(sale.closedAt || sale.createdAt, sale.locationId);
      var toKey = dateKeyOf(next.closedAt, sale.locationId);
      if (fromKey && toKey && fromKey !== toKey) {
        events.push({
          type: "date_changed",
          byName: who,
          from: formatDate(sale.closedAt || sale.createdAt),
          to: formatDate(next.closedAt)
        });
      }
    }
    if (next.status && next.status !== sale.status) {
      if (next.status === "open") {
        events.push({
          type: "reopened",
          byName: who,
          from: "Closed",
          to: "Open",
          fromWhen: sale.closedAt || sale.createdAt || null,
          fromBy: lastCloserName(sale) || who
        });
      } else if (next.status === "closed") {
        events.push({
          type: "closed",
          byName: who,
          from: "Open",
          to: "Closed"
        });
      }
    }
    if (next.refundAmount != null) {
      events.push({
        type: "refunded",
        byName: who,
        amount: Number(next.refundAmount) || 0,
        previousTotal: Number(sale.total) || 0
      });
    }
    return events;
  }

  function historyLabel(entry, locationId) {
    var row = entry && typeof entry === "object" ? entry : {};
    var by = row.byName || "staff";
    var when = formatWhen(row.at, locationId);
    var on = when && when !== "—" ? " on " + when : "";
    if (row.type === "date_changed") {
      return "Date changed from " + (row.from || "—") + " to " + (row.to || "—") + " by " + by + on + ".";
    }
    if (row.type === "reopened") {
      var closedWhen = formatWhen(row.fromWhen, locationId);
      var closedBy = row.fromBy || "staff";
      var closedOn = closedWhen && closedWhen !== "—" ? " on " + closedWhen : "";
      return "Reopened by " + by + on + ". It was closed" + closedOn + " by " + closedBy + ".";
    }
    if (row.type === "closed") {
      return "Closed by " + by + on + ".";
    }
    if (row.type === "refunded") {
      return "Refunded " + money(row.amount) + " of the " + money(row.previousTotal) + " total by " + by + on + ".";
    }
    return "";
  }

  function dateKeyOf(value, locationId) {
    var date = coerceDate(value);
    var tm = window.ffBookingTime;
    if (date && tm && typeof tm.zonedDateKey === "function") return tm.zonedDateKey(date, locationId);
    if (!date) return "";
    return date.toISOString().slice(0, 10);
  }

  function channelFromSource(source) {
    var key = trimText(source);
    if (key === "online") return "online";
    return "staff";
  }

  function defaultFilters() {
    return {
      locationId: "",
      saleNumber: "",
      amountFrom: "",
      amountTo: "",
      date: "all",
      customFrom: "",
      customTo: "",
      status: "all",
      method: "all",
      processor: "all",
      channel: "all"
    };
  }

  function todayKey() {
    var tm = window.ffBookingTime;
    return tm && typeof tm.todayDateKey === "function" ? tm.todayDateKey() : "";
  }

  function shiftKey(key, days) {
    var tm = window.ffBookingTime;
    if (tm && typeof tm.addDays === "function") return tm.addDays(key, days);
    return key;
  }

  function startOfWeek(key) {
    var tm = window.ffBookingTime;
    var parts = tm && tm.parseDateKey ? tm.parseDateKey(key) : null;
    if (!parts) return key;
    var dow = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0)).getUTCDay();
    return shiftKey(key, -dow);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function monthRange(year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!y || m < 1 || m > 12) return null;
    var last = new Date(Date.UTC(y, m, 0, 12, 0, 0));
    return {
      from: y + "-" + pad2(m) + "-01",
      to: last.toISOString().slice(0, 10)
    };
  }

  function recentMonthPresets() {
    var today = todayKey();
    var tm = window.ffBookingTime;
    var parts = tm && tm.parseDateKey ? tm.parseDateKey(today) : null;
    if (!parts) return [];
    var list = [];
    var y = parts.y;
    var m = parts.m;
    for (var i = 0; i < 3; i += 1) {
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      list.push({
        value: "month:" + y + "-" + pad2(m),
        label: MONTHS[m - 1] + (y !== parts.y ? " " + y : "")
      });
    }
    return list;
  }

  function dateRangeFor(filters) {
    var f = filters && typeof filters === "object" ? filters : {};
    var today = todayKey();
    if (!today) return null;
    var kind = trimText(f.date) || "all";
    if (kind === "all") return null;
    if (kind === "today") return { from: today, to: today };
    if (kind === "yesterday") {
      var y = shiftKey(today, -1);
      return { from: y, to: y };
    }
    if (kind === "this_week") return { from: startOfWeek(today), to: today };
    if (kind === "last_week") {
      var start = shiftKey(startOfWeek(today), -7);
      return { from: start, to: shiftKey(start, 6) };
    }
    if (kind === "last_two_weeks") return { from: shiftKey(today, -13), to: today };
    if (kind.indexOf("month:") === 0) {
      var ym = kind.slice(6).match(/^(\d{4})-(\d{2})$/);
      return ym ? monthRange(ym[1], ym[2]) : null;
    }
    if (kind === "custom") {
      var from = trimText(f.customFrom);
      var to = trimText(f.customTo);
      if (!from && !to) return null;
      return { from: from || to, to: to || from };
    }
    return null;
  }

  function saleHasRefund(sale) {
    return !!(sale && (sale.status === "refunded" || (sale.history || []).some(function (row) {
      return row && row.type === "refunded";
    })));
  }

  function matchesFilters(sale, filters) {
    var f = filters && typeof filters === "object" ? filters : defaultFilters();
    if (!sale) return false;
    var loc = trimText(f.locationId);
    if (loc && loc !== "all" && sale.locationId !== loc) return false;
    var num = collapseSpaces(f.saleNumber).replace(/^#/, "");
    if (num && String(sale.saleNumber || "").indexOf(num) === -1 && saleLabel(sale).toLowerCase().indexOf(num.toLowerCase()) === -1) {
      return false;
    }
    var fromAmt = Number(f.amountFrom);
    var toAmt = Number(f.amountTo);
    var total = Number(sale.total) || 0;
    if (Number.isFinite(fromAmt) && String(f.amountFrom).trim() !== "" && total < fromAmt) return false;
    if (Number.isFinite(toAmt) && String(f.amountTo).trim() !== "" && total > toAmt) return false;
    var range = dateRangeFor(f);
    if (range) {
      var key = dateKeyOf(sale.closedAt || sale.createdAt, sale.locationId);
      if (!key || (range.from && key < range.from) || (range.to && key > range.to)) return false;
    }
    var status = trimText(f.status) || "all";
    if (status === "refunded" && !saleHasRefund(sale)) return false;
    if (status === "reversed" && sale.status !== "void" && sale.status !== "reversed") return false;
    if (status !== "all" && status !== "refunded" && status !== "reversed" && sale.status !== status) return false;
    var method = trimText(f.method) || "all";
    if (method !== "all" && (sale.method || "none") !== method) return false;
    var processor = trimText(f.processor) || "all";
    if (processor !== "all" && (sale.processor || "none") !== processor) return false;
    var channel = trimText(f.channel) || "all";
    if (channel !== "all" && (sale.channel || channelFromSource(sale.source)) !== channel) return false;
    return true;
  }

  function filtersAreActive(filters) {
    var f = filters && typeof filters === "object" ? filters : defaultFilters();
    var base = defaultFilters();
    return Object.keys(base).some(function (key) {
      return String(f[key] || "") !== String(base[key] || "");
    });
  }

  function matchesQuery(sale, rawQuery) {
    var q = collapseSpaces(rawQuery).toLowerCase();
    if (!q) return true;
    var number = saleLabel(sale).toLowerCase();
    var name = clientName(sale).toLowerCase();
    return number.indexOf(q) !== -1 || name.indexOf(q) !== -1 || String(sale.saleNumber || "").indexOf(q) !== -1;
  }

  window.ffBookingSalesModel = {
    NOTES_MAX: NOTES_MAX,
    STATUSES: STATUSES.slice(),
    SOURCES: SOURCES.slice(),
    money: money,
    normalizeTip: normalizeTip,
    normalizeNotes: normalizeNotes,
    isStatus: isStatus,
    statusLabel: statusLabel,
    saleLabel: saleLabel,
    clientName: clientName,
    itemsFromAppointment: itemsFromAppointment,
    normalizeItems: normalizeItems,
    totalsFromItems: totalsFromItems,
    normalizeCreate: normalizeCreate,
    fromAppointment: fromAppointment,
    fromDoc: fromDoc,
    formatDate: formatDate,
    formatMonthYear: formatMonthYear,
    formatWhen: formatWhen,
    clientSinceLabel: clientSinceLabel,
    dateKeyOf: dateKeyOf,
    coerceDate: coerceDate,
    normalizeHistory: normalizeHistory,
    historyFromPatch: historyFromPatch,
    historyLabel: historyLabel,
    channelFromSource: channelFromSource,
    defaultFilters: defaultFilters,
    recentMonthPresets: recentMonthPresets,
    dateRangeFor: dateRangeFor,
    matchesFilters: matchesFilters,
    filtersAreActive: filtersAreActive,
    matchesQuery: matchesQuery
  };
})();
