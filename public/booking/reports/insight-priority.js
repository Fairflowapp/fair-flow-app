/**
 * Presentation-only insight ranking. Does not change stored report.insights.
 * Drops near-duplicate owner sentences and keeps a short operational list.
 */
(function () {
  var DISPLAY_LIMIT = 8;
  var WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function topic(line) {
    var text = String(line || "");
    if (text.indexOf("No appointments were found") !== -1) return "empty";
    if (text.indexOf("with no booked appointments") !== -1) return "empty-capacity";
    if (text.indexOf("left as calendar gaps") !== -1) return "gap-total";
    if (text.indexOf("30 minutes or less") !== -1) return "gap-small";
    if (text.indexOf("Most calendar gap time occurred") !== -1) return "gap-peak";
    if (text.indexOf("most concentrated between") !== -1) return "gap-hour";
    if (text.indexOf("most calendar gap time") !== -1) return "gap-provider";
    if (text.indexOf("left unused because of calendar gaps") !== -1) return "gap-unused";
    if (text.indexOf("most utilized provider") !== -1) return "util-provider";
    if (text.indexOf("between appointments") !== -1) return "idle-open";
    if (text.indexOf("below 50% utilization") !== -1) return "util-low";
    if (text.indexOf("lowest utilization") !== -1) return "util-weekday";
    if (text.indexOf("most utilized weekday") !== -1) return "util-weekday-high";
    if (text.indexOf("highest booked service demand") !== -1) return "service-demand";
    if (text.indexOf("of booked service time") !== -1) return "service-mix";
    if (text.indexOf("booked value per provider hour") !== -1) return "service-rate";
    if (text.indexOf("booked appointment value") !== -1) return "service-value";
    if (text.indexOf("assigned to one provider") !== -1) return "service-provider";
    if (text.indexOf("multiple appointments") !== -1) return "client-repeat";
    if (text.indexOf("identified-client appointments") !== -1) return "client-repeat-share";
    if (text.indexOf("more than one service type") !== -1) return "client-multi";
    if (text.indexOf("requested-provider bookings") !== -1) return "client-requested";
    if (text.indexOf("consistently requested") !== -1) return "client-consistent";
    if (text.indexOf("days between appointments") !== -1) return "client-spacing";
    if (text.indexOf("service lines were requested") !== -1) return "requested-lines";
    if (text.indexOf("were first visits") !== -1) return "first-visits";
    if (text.indexOf("Cancellation rate") !== -1) return "cancel";
    if (text.indexOf("Estimated unused service capacity") !== -1) return "estimate";
    if (text.indexOf("provider hours of calendar gaps") !== -1) return "gap-weekday";
    return "other";
  }

  function score(kind) {
    var order = {
      empty: 100,
      "empty-capacity": 95,
      "gap-total": 90,
      "gap-peak": 86,
      "gap-hour": 85,
      "util-weekday": 84,
      "gap-provider": 82,
      "util-low": 78,
      "util-provider": 76,
      "service-demand": 70,
      "service-rate": 66,
      "client-repeat": 62,
      "client-repeat-share": 60,
      estimate: 55,
      "gap-small": 52,
      "client-requested": 50,
      "client-multi": 48,
      "client-consistent": 46,
      "client-spacing": 44,
      "util-weekday-high": 42,
      "gap-weekday": 40,
      "service-value": 38,
      "service-provider": 36,
      cancel: 30,
      "idle-open": 28,
      "first-visits": 20,
      "requested-lines": 18,
      "service-mix": 16,
      "gap-unused": 12,
      other: 10
    };
    return order[kind] || 0;
  }

  function weekdayIn(line) {
    var i;
    for (i = 0; i < WEEKDAYS.length; i += 1) {
      if (String(line || "").indexOf(WEEKDAYS[i]) !== -1) return WEEKDAYS[i];
    }
    return "";
  }

  function presentInsights(lines, limit) {
    var cap = Number(limit) > 0 ? Number(limit) : DISPLAY_LIMIT;
    var seenTopic = {};
    var weekdayCount = {};
    var skipIf = {
      "gap-unused": "gap-total",
      "service-mix": "service-demand",
      "requested-lines": "client-requested",
      "gap-weekday": "util-weekday"
    };
    return (lines || []).map(function (line, index) {
      var kind = topic(line);
      return { line: line, kind: kind, index: index, score: score(kind) };
    }).sort(function (a, b) {
      return b.score - a.score || a.index - b.index;
    }).filter(function (row) {
      if (seenTopic[row.kind]) return false;
      var required = skipIf[row.kind];
      if (required && seenTopic[required]) return false;
      var day = weekdayIn(row.line);
      if (day) {
        weekdayCount[day] = (weekdayCount[day] || 0) + 1;
        if (weekdayCount[day] > 2) return false;
      }
      seenTopic[row.kind] = true;
      return true;
    }).slice(0, cap).sort(function (a, b) {
      return b.score - a.score || a.index - b.index;
    }).map(function (row) {
      return row.line;
    });
  }

  window.ffBookingReportsInsightPriority = {
    DISPLAY_LIMIT: DISPLAY_LIMIT,
    topic: topic,
    presentInsights: presentInsights
  };
})();
