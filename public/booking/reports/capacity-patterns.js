/**
 * Capacity pattern aggregation: daily, weekday, and clock-hour buckets.
 * Uses the same working/booked/gap semantics as provider capacity.
 * No Firestore.
 */
(function () {
  var WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var WEEKDAY_LABELS = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday"
  };
  var MIN_COMPARE_WORKING = 120;

  function compute() {
    return window.ffBookingReportsIntelligenceCompute || null;
  }

  function percent(part, whole) {
    var api = compute();
    if (api && typeof api.percent === "function") return api.percent(part, whole);
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  function formatHours(minutes) {
    var api = compute();
    if (api && typeof api.formatHours === "function") return api.formatHours(minutes);
    var hours = Number(minutes) / 60;
    if (!Number.isFinite(hours) || hours === 0) return "0";
    if (Math.abs(hours - Math.round(hours)) < 0.05) return String(Math.round(hours));
    return String(Math.round(hours * 10) / 10);
  }

  function hourWord(count) {
    return Number(count) === 1 ? "hour" : "hours";
  }

  function clockHourLabel(hour) {
    var h = ((Number(hour) % 24) + 24) % 24;
    var suffix = h >= 12 ? "PM" : "AM";
    var display = h % 12;
    if (!display) display = 12;
    return display + ":00 " + suffix;
  }

  function hourRangeLabel(hour) {
    return clockHourLabel(hour) + " and " + clockHourLabel(hour + 1);
  }

  function weekdayFromDateKey(dateKey) {
    var tm = window.ffBookingTime;
    if (tm && typeof tm.weekdayKey === "function") {
      return String(tm.weekdayKey(dateKey) || "").toLowerCase();
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
    if (!m) return "";
    var utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][utc.getUTCDay()] || "";
  }

  function emptyBucket() {
    return {
      workingMinutes: 0,
      bookedMinutes: 0,
      idleMinutes: 0,
      gapMinutes: 0,
      openEdgeMinutes: 0,
      percent: 0,
      gapSharePercent: 0,
      idleSharePercent: 0
    };
  }

  function finalizeBucket(row) {
    row.idleMinutes = Math.max(0, row.workingMinutes - row.bookedMinutes);
    row.openEdgeMinutes = Math.max(0, row.idleMinutes - row.gapMinutes);
    row.percent = percent(row.bookedMinutes, row.workingMinutes);
    row.gapSharePercent = percent(row.gapMinutes, row.workingMinutes);
    row.idleSharePercent = percent(row.idleMinutes, row.workingMinutes);
    return row;
  }

  function addTotals(target, fact) {
    target.workingMinutes += fact.workingMinutes || 0;
    target.bookedMinutes += fact.bookedMinutes || 0;
    target.gapMinutes += fact.gapMinutes || 0;
    target.openEdgeMinutes += fact.openEdgeMinutes || 0;
  }

  function allocateToHours(startMin, endMin, addFn) {
    var start = Number(startMin);
    var end = Number(endMin);
    if (!(end > start)) return;
    var t = start;
    while (t < end) {
      var hour = Math.floor(t / 60);
      if (hour < 0 || hour > 23) {
        t = (hour + 1) * 60;
        continue;
      }
      var sliceEnd = Math.min(end, (hour + 1) * 60);
      addFn(hour, sliceEnd - t);
      t = sliceEnd;
    }
  }

  function buildDays(facts) {
    var byKey = {};
    (facts || []).forEach(function (fact) {
      var key = String(fact.dateKey || "");
      if (!key || !(fact.workingMinutes > 0)) return;
      if (!byKey[key]) {
        byKey[key] = Object.assign({ dateKey: key, weekday: weekdayFromDateKey(key) }, emptyBucket());
      }
      addTotals(byKey[key], fact);
    });
    return Object.keys(byKey).sort().map(function (key) {
      return finalizeBucket(byKey[key]);
    });
  }

  function buildWeekdays(days) {
    var byDay = {};
    (days || []).forEach(function (day) {
      if (!(day.workingMinutes > 0)) return;
      var key = day.weekday;
      if (!key) return;
      if (!byDay[key]) {
        byDay[key] = Object.assign({
          weekday: key,
          label: WEEKDAY_LABELS[key] || key,
          dateCount: 0
        }, emptyBucket());
      }
      byDay[key].dateCount += 1;
      addTotals(byDay[key], day);
    });
    return WEEKDAYS.map(function (key) {
      return byDay[key] ? finalizeBucket(byDay[key]) : null;
    }).filter(Boolean);
  }

  function buildHours(facts) {
    var hours = [];
    var i;
    for (i = 0; i < 24; i += 1) {
      hours[i] = Object.assign({ hour: i, label: hourRangeLabel(i) }, emptyBucket());
    }
    (facts || []).forEach(function (fact) {
      (fact.windows || []).forEach(function (win) {
        allocateToHours(win.startMin, win.endMin, function (hour, minutes) {
          hours[hour].workingMinutes += minutes;
        });
      });
      (fact.occupied || []).forEach(function (block) {
        allocateToHours(block.startMin, block.endMin, function (hour, minutes) {
          hours[hour].bookedMinutes += minutes;
        });
      });
      (fact.gaps || []).forEach(function (gap) {
        allocateToHours(gap.startMin, gap.endMin, function (hour, minutes) {
          hours[hour].gapMinutes += minutes;
        });
      });
    });
    return hours.filter(function (row) {
      return row.workingMinutes > 0;
    }).map(function (row) {
      row.shortLabel = clockHourLabel(row.hour) + "–" + clockHourLabel(row.hour + 1);
      return finalizeBucket(row);
    });
  }

  function comparable(rows, minWorking) {
    return (rows || []).filter(function (row) {
      return row && row.workingMinutes >= minWorking;
    });
  }

  function pickExtreme(rows, key, preferHigh) {
    if (!rows || !rows.length) return null;
    return rows.slice().sort(function (a, b) {
      var left = Number(a[key]) || 0;
      var right = Number(b[key]) || 0;
      return preferHigh ? right - left : left - right;
    })[0];
  }

  function summarize(days, weekdays, hours) {
    var dayCompare = comparable(days, MIN_COMPARE_WORKING);
    var weekCompare = comparable(weekdays, MIN_COMPARE_WORKING);
    var hourCompare = comparable(hours, MIN_COMPARE_WORKING);
    return {
      strongestDay: dayCompare.length ? pickExtreme(dayCompare, "percent", true) : null,
      weakestDay: dayCompare.length > 1 ? pickExtreme(dayCompare, "percent", false) : null,
      mostGapDay: pickExtreme((days || []).filter(function (row) { return row.gapMinutes > 0; }), "gapMinutes", true),
      strongestWeekday: weekCompare.length > 1 ? pickExtreme(weekCompare, "percent", true) : null,
      weakestWeekday: weekCompare.length > 1 ? pickExtreme(weekCompare, "percent", false) : null,
      mostGapWeekday: pickExtreme((weekdays || []).filter(function (row) { return row.gapMinutes > 0; }), "gapMinutes", true),
      mostGapHour: pickExtreme((hours || []).filter(function (row) { return row.gapMinutes > 0; }), "gapMinutes", true),
      weakestHour: hourCompare.length > 1 ? pickExtreme(hourCompare, "percent", false) : null
    };
  }

  function emptyPatterns() {
    return { days: [], weekdays: [], hours: [], summary: summarize([], [], []) };
  }

  function buildPatterns(dayFacts) {
    var days = buildDays(dayFacts);
    var weekdays = buildWeekdays(days);
    var hours = buildHours(dayFacts);
    return {
      days: days,
      weekdays: weekdays,
      hours: hours,
      summary: summarize(days, weekdays, hours)
    };
  }

  function attach(report, dayFacts) {
    if (!report) return emptyPatterns();
    report.patterns = buildPatterns(dayFacts);
    return report.patterns;
  }

  function appendInsights(out, report, phrase) {
    var patterns = report && report.patterns;
    if (!patterns || !out) return;
    var summary = patterns.summary || {};
    var list = out;

    if (summary.weakestWeekday) {
      list.push(
        summary.weakestWeekday.label + " had the lowest utilization " + phrase +
        " at " + summary.weakestWeekday.percent + "%."
      );
    }
    if (summary.strongestWeekday) {
      list.push(
        summary.strongestWeekday.label + " was the most utilized weekday at " +
        summary.strongestWeekday.percent + "%."
      );
    }
    if (summary.mostGapWeekday && summary.mostGapWeekday.gapMinutes > 0) {
      list.push(
        summary.mostGapWeekday.label + " had " + formatHours(summary.mostGapWeekday.gapMinutes) +
        " provider " + hourWord(summary.mostGapWeekday.gapMinutes / 60) + " of calendar gaps."
      );
    }
    if (summary.mostGapHour && summary.mostGapHour.gapMinutes > 0) {
      list.push(
        "Calendar gaps were most concentrated between " + summary.mostGapHour.label.replace(" and ", " and ") +
        ": " + formatHours(summary.mostGapHour.gapMinutes) + " provider " +
        hourWord(summary.mostGapHour.gapMinutes / 60) + "."
      );
    }
    if (summary.weakestHour) {
      list.push(
        "Between " + summary.weakestHour.label + ", providers were booked for " +
        summary.weakestHour.percent + "% of available working time."
      );
    }
  }

  window.ffBookingReportsCapacityPatterns = {
    MIN_COMPARE_WORKING: MIN_COMPARE_WORKING,
    WEEKDAYS: WEEKDAYS.slice(),
    WEEKDAY_LABELS: WEEKDAY_LABELS,
    weekdayFromDateKey: weekdayFromDateKey,
    allocateToHours: allocateToHours,
    clockHourLabel: clockHourLabel,
    buildPatterns: buildPatterns,
    attach: attach,
    appendInsights: appendInsights,
    emptyPatterns: emptyPatterns
  };
})();
