/**
 * Sales Summary numbers and date ranges. No Firestore.
 */
(function () {
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function pad2(n) {
    return (Number(n) < 10 ? "0" : "") + Number(n);
  }

  function parseKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function addDays(dateKey, delta) {
    var p = parseKey(dateKey);
    if (!p) return "";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(delta || 0)));
    return utc.getUTCFullYear() + "-" + pad2(utc.getUTCMonth() + 1) + "-" + pad2(utc.getUTCDate());
  }

  function startOfWeek(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return dateKey;
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0));
    var dow = utc.getUTCDay();
    var back = dow === 0 ? 6 : dow - 1;
    return addDays(dateKey, -back);
  }

  function monthRange(year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!y || m < 1 || m > 12) return { fromKey: "", toKey: "" };
    var last = new Date(Date.UTC(y, m, 0, 12, 0, 0));
    return {
      fromKey: y + "-" + pad2(m) + "-01",
      toKey: last.toISOString().slice(0, 10)
    };
  }

  function shortDate(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return "";
    return MONTHS_SHORT[p.m - 1] + " " + p.d;
  }

  function rangeText(fromKey, toKey) {
    if (!fromKey) return "";
    if (!toKey || fromKey === toKey) return shortDate(fromKey);
    return shortDate(fromKey) + " - " + shortDate(toKey);
  }

  function rangeForPreset(kind, todayKey, customFrom, customTo) {
    var today = trim(todayKey);
    var key = trim(kind) || "today";
    if (!today) return { fromKey: "", toKey: "" };
    if (key === "today") return { fromKey: today, toKey: today };
    if (key === "yesterday") {
      var y = addDays(today, -1);
      return { fromKey: y, toKey: y };
    }
    if (key === "this_week") {
      var weekStart = startOfWeek(today);
      return { fromKey: weekStart, toKey: addDays(weekStart, 6) };
    }
    if (key === "last_week") {
      var lastStart = addDays(startOfWeek(today), -7);
      return { fromKey: lastStart, toKey: addDays(lastStart, 6) };
    }
    if (key === "last_two_weeks") {
      var thisStart = startOfWeek(today);
      return { fromKey: addDays(thisStart, -14), toKey: addDays(thisStart, -1) };
    }
    if (key.indexOf("month:") === 0) {
      var ym = key.slice(6).match(/^(\d{4})-(\d{2})$/);
      return ym ? monthRange(ym[1], ym[2]) : { fromKey: "", toKey: "" };
    }
    if (key === "custom") {
      var from = trim(customFrom);
      var to = trim(customTo);
      if (!from && !to) return { fromKey: "", toKey: "" };
      if (from && to && from > to) return { fromKey: to, toKey: from };
      return { fromKey: from || to, toKey: to || from };
    }
    return { fromKey: today, toKey: today };
  }

  function monthPresets(todayKey, count) {
    var p = parseKey(todayKey);
    if (!p) return [];
    var n = Number(count) > 0 ? Number(count) : 12;
    var y = p.y;
    var m = p.m;
    var list = [];
    var i;
    for (i = 0; i < n; i += 1) {
      list.push({
        value: "month:" + y + "-" + pad2(m),
        label: MONTHS[m - 1] + " " + y
      });
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
    }
    return list;
  }

  function datePresets(todayKey) {
    var today = trim(todayKey);
    var yesterday = addDays(today, -1);
    var thisWeek = rangeForPreset("this_week", today);
    var lastWeek = rangeForPreset("last_week", today);
    var lastTwo = rangeForPreset("last_two_weeks", today);
    return [
      { value: "today", label: "Today (" + shortDate(today) + ")" },
      { value: "yesterday", label: "Yesterday (" + shortDate(yesterday) + ")" },
      { value: "this_week", label: "This Week (" + rangeText(thisWeek.fromKey, thisWeek.toKey) + ")" },
      { value: "last_week", label: "Last Week (" + rangeText(lastWeek.fromKey, lastWeek.toKey) + ")" },
      { value: "last_two_weeks", label: "Last Two Weeks (" + rangeText(lastTwo.fromKey, lastTwo.toKey) + ")" },
      { value: "custom", label: "Custom Time Period" }
    ].concat(monthPresets(today, 12));
  }

  function dateKeyOf(sale) {
    if (sale && sale.dateKey) return String(sale.dateKey).trim();
    var api = window.ffBookingSalesModel;
    if (api && typeof api.dateKeyOf === "function") {
      return String(api.dateKeyOf(sale && (sale.closedAt || sale.createdAt), sale && sale.locationId) || "").trim();
    }
    return "";
  }

  function longDate(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return "";
    return MONTHS[p.m - 1] + " " + p.d + ", " + p.y;
  }

  function periodLabel(fromKey, toKey) {
    if (!fromKey) return "";
    if (!toKey || fromKey === toKey) return longDate(fromKey);
    return longDate(fromKey) + " - " + longDate(toKey);
  }

  function itemAmount(item) {
    return Number(item && item.amount) || 0;
  }

  function refundAmount(sale) {
    var sum = 0;
    (sale && sale.history || []).forEach(function (row) {
      if (row && row.type === "refunded") sum += Number(row.amount) || 0;
    });
    if (!sum) sum = Number(sale && sale.refundAmount) || 0;
    return sum;
  }

  function emptyRow(dateKey) {
    return {
      dateKey: dateKey || "",
      sales: 0,
      services: 0,
      serviceSales: 0,
      products: 0,
      productSales: 0,
      subtotal: 0,
      customFees: 0,
      tax: 0,
      tip: 0,
      grossTotal: 0,
      refunds: 0,
      adjustedTotal: 0,
      total: 0
    };
  }

  function breakdown(sale) {
    var items = (sale && sale.items) || [];
    var services = 0;
    var serviceSales = 0;
    var products = 0;
    var productSales = 0;
    items.forEach(function (item) {
      var amt = itemAmount(item);
      if (item && item.kind === "product") {
        products += 1;
        productSales += amt;
        return;
      }
      services += 1;
      serviceSales += amt;
    });
    if (serviceSales === 0 && products === 0) {
      serviceSales = Number(sale && sale.subtotal) || 0;
    }
    var customFees = Number(sale && (sale.customFees || sale.fees)) || 0;
    var tax = Number(sale && sale.tax) || 0;
    var tip = Number(sale && sale.tip) || 0;
    var subtotal = serviceSales + productSales;
    var grossTotal = subtotal + customFees + tax + tip;
    var refunds = refundAmount(sale);
    var adjustedTotal = Math.round((grossTotal - refunds) * 100) / 100;
    return {
      services: services,
      serviceSales: serviceSales,
      products: products,
      productSales: productSales,
      subtotal: subtotal,
      customFees: customFees,
      tax: tax,
      tip: tip,
      grossTotal: grossTotal,
      refunds: refunds,
      adjustedTotal: adjustedTotal
    };
  }

  function addRow(row, parts) {
    row.sales += 1;
    row.services += parts.services;
    row.serviceSales += parts.serviceSales;
    row.products += parts.products;
    row.productSales += parts.productSales;
    row.subtotal += parts.subtotal;
    row.customFees += parts.customFees;
    row.tax += parts.tax;
    row.tip += parts.tip;
    row.grossTotal += parts.grossTotal;
    row.refunds += parts.refunds;
    row.adjustedTotal += parts.adjustedTotal;
    row.total += parts.adjustedTotal;
  }

  function inRange(dateKey, fromKey, toKey) {
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function locationAllowed(sale, options) {
    var ids = options && options.locationIds;
    if (Array.isArray(ids) && ids.length) {
      return ids.indexOf(trim(sale && sale.locationId)) !== -1;
    }
    var locationId = trim(options && options.locationId);
    if (locationId && locationId !== "all") return trim(sale && sale.locationId) === locationId;
    return true;
  }

  function summarize(sales, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var fromKey = trim(options.fromKey);
    var toKey = trim(options.toKey);
    var days = {};
    var order = [];
    (sales || []).forEach(function (sale) {
      if (!sale || sale.status === "void" || sale.status === "open") return;
      if (!locationAllowed(sale, options)) return;
      var key = dateKeyOf(sale);
      if (!inRange(key, fromKey, toKey)) return;
      if (!days[key]) {
        days[key] = emptyRow(key);
        order.push(key);
      }
      addRow(days[key], breakdown(sale));
    });
    order.sort();
    var list = order.map(function (key) { return days[key]; });
    var totals = list.reduce(function (sum, row) {
      sum.sales += row.sales;
      sum.services += row.services;
      sum.serviceSales += row.serviceSales;
      sum.products += row.products;
      sum.productSales += row.productSales;
      sum.subtotal += row.subtotal;
      sum.customFees += row.customFees;
      sum.tax += row.tax;
      sum.tip += row.tip;
      sum.grossTotal += row.grossTotal;
      sum.refunds += row.refunds;
      sum.adjustedTotal += row.adjustedTotal;
      sum.total += row.total;
      return sum;
    }, emptyRow(""));
    return { days: list, totals: totals };
  }

  window.ffBookingReportsCompute = {
    dateKeyOf: dateKeyOf,
    inRange: inRange,
    addDays: addDays,
    startOfWeek: startOfWeek,
    shortDate: shortDate,
    longDate: longDate,
    periodLabel: periodLabel,
    rangeText: rangeText,
    rangeForPreset: rangeForPreset,
    datePresets: datePresets,
    monthPresets: monthPresets,
    refundAmount: refundAmount,
    breakdown: breakdown,
    summarize: summarize
  };
})();
