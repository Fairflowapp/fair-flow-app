/**
 * Booking Calendar sizing + coordinates.
 * ONE token set — CSS and render both read these values.
 * 15-minute positioning: top = axisPadTop + (minutes - axisStart) * (hourH / 60).
 */
(function () {
  var TOKENS = Object.freeze({
    minColW: 216,
    timeW: 88,
    hourH: 92,
    headerH: 52,
    axisPadTop: 14,
    snapMin: 15
  });

  function tokens() {
    return {
      minColW: TOKENS.minColW,
      timeW: TOKENS.timeW,
      hourH: TOKENS.hourH,
      headerH: TOKENS.headerH,
      axisPadTop: TOKENS.axisPadTop,
      snapMin: TOKENS.snapMin,
      qtrH: TOKENS.hourH / 4,
      pxPerMinute: TOKENS.hourH / 60
    };
  }

  function columnWidth(employeeCount, availablePx) {
    var n = Math.max(1, Number(employeeCount) || 0);
    var available = Math.max(0, Number(availablePx) || 0);
    return Math.max(TOKENS.minColW, available / n);
  }

  function columnsWidth(employeeCount, availablePx) {
    return columnWidth(employeeCount, availablePx) * Math.max(1, Number(employeeCount) || 0);
  }

  function minutesToTop(absMinutes, axisStartMin) {
    var t = tokens();
    return t.axisPadTop + (Number(absMinutes) - Number(axisStartMin)) * t.pxPerMinute;
  }

  function windowToRect(startMin, endMin, axisStartMin, axisEndMin) {
    var start = Math.max(Number(startMin), Number(axisStartMin));
    var end = Math.min(Number(endMin), Number(axisEndMin));
    if (!(end > start)) return null;
    return {
      top: minutesToTop(start, axisStartMin),
      height: (end - start) * tokens().pxPerMinute
    };
  }

  function axisHeight(axisStartMin, axisEndMin) {
    var t = tokens();
    return t.axisPadTop + Math.max(0, (Number(axisEndMin) - Number(axisStartMin)) * t.pxPerMinute);
  }

  function hourMarks(axisStartMin, axisEndMin) {
    var start = Math.ceil(Number(axisStartMin) / 60) * 60;
    var marks = [];
    for (var m = start; m <= Number(axisEndMin); m += 60) marks.push(m);
    return marks;
  }

  function applyTokensToElement(el) {
    if (!el || !el.style) return;
    var t = tokens();
    el.style.setProperty("--ff-cal-min-col-w", t.minColW + "px");
    el.style.setProperty("--ff-cal-time-w", t.timeW + "px");
    el.style.setProperty("--ff-cal-hour-h", t.hourH + "px");
    el.style.setProperty("--ff-cal-qtr-h", t.qtrH + "px");
    el.style.setProperty("--ff-cal-header-h", t.headerH + "px");
    el.style.setProperty("--ff-cal-axis-pad", t.axisPadTop + "px");
  }

  window.ffBookingCalLayout = {
    tokens: tokens,
    columnWidth: columnWidth,
    columnsWidth: columnsWidth,
    minutesToTop: minutesToTop,
    windowToRect: windowToRect,
    axisHeight: axisHeight,
    hourMarks: hourMarks,
    applyTokensToElement: applyTokensToElement
  };
})();
