/**
 * Booking Calendar sizing + coordinates.
 * ONE token set for density, columns, and time→Y / duration→height.
 *
 * Y = axisPadTop + (minutesFromMidnight - axisStart) * (pixelsPerHour / 60)
 * height = durationMinutes * (pixelsPerHour / 60)
 *
 * Two widths, kept separate:
 *   provider content = preferredColW * employeeCount (never stretched)
 *   canvas = max(available workspace surface, provider content)
 * The canvas owns the scheduling coordinate system. Provider columns
 * sit inside it. Leftover canvas is unused workspace, not fake columns.
 */
(function () {
  var TOKENS = Object.freeze({
    pixelsPerHour: 48,
    preferredColW: 152,
    minColW: 128,
    maxColW: 168,
    timeW: 52,
    headerH: 36,
    axisPadTop: 8,
    snapMin: 15
  });

  function tokens() {
    return {
      pixelsPerHour: TOKENS.pixelsPerHour,
      hourH: TOKENS.pixelsPerHour,
      preferredColW: TOKENS.preferredColW,
      minColW: TOKENS.minColW,
      maxColW: TOKENS.maxColW,
      timeW: TOKENS.timeW,
      headerH: TOKENS.headerH,
      axisPadTop: TOKENS.axisPadTop,
      snapMin: TOKENS.snapMin,
      halfH: TOKENS.pixelsPerHour / 2,
      pxPerMinute: TOKENS.pixelsPerHour / 60
    };
  }

  function columnWidth() {
    return TOKENS.preferredColW;
  }

  function columnsWidth(employeeCount) {
    return columnWidth() * Math.max(0, Number(employeeCount) || 0);
  }

  function providerContentWidth(employeeCount) {
    return columnsWidth(employeeCount);
  }

  function canvasWidth(availableSurfaceWidth, employeeCount) {
    var content = providerContentWidth(employeeCount);
    var available = Math.max(0, Number(availableSurfaceWidth) || 0);
    return Math.max(content, available);
  }

  function minutesToTop(absMinutes, axisStartMin) {
    var t = tokens();
    return t.axisPadTop + (Number(absMinutes) - Number(axisStartMin)) * t.pxPerMinute;
  }

  function durationToHeight(durationMinutes) {
    return Number(durationMinutes) * tokens().pxPerMinute;
  }

  function windowToRect(startMin, endMin, axisStartMin, axisEndMin) {
    var start = Math.max(Number(startMin), Number(axisStartMin));
    var end = Math.min(Number(endMin), Number(axisEndMin));
    if (!(end > start)) return null;
    return {
      top: minutesToTop(start, axisStartMin),
      height: durationToHeight(end - start)
    };
  }

  function axisHeight(axisStartMin, axisEndMin) {
    var t = tokens();
    return t.axisPadTop + durationToHeight(Number(axisEndMin) - Number(axisStartMin));
  }

  function hourMarks(axisStartMin, axisEndMin) {
    var start = Math.ceil(Number(axisStartMin) / 60) * 60;
    var marks = [];
    for (var m = start; m <= Number(axisEndMin); m += 60) marks.push(m);
    return marks;
  }

  function halfHourMarks(axisStartMin, axisEndMin) {
    var start = Math.ceil(Number(axisStartMin) / 30) * 30;
    var marks = [];
    for (var m = start; m < Number(axisEndMin); m += 30) {
      if (m % 60 !== 0) marks.push(m);
    }
    return marks;
  }

  function applyTokensToElement(el) {
    if (!el || !el.style) return;
    var t = tokens();
    el.style.setProperty("--ff-cal-col-w", t.preferredColW + "px");
    el.style.setProperty("--ff-cal-min-col-w", t.minColW + "px");
    el.style.setProperty("--ff-cal-max-col-w", t.maxColW + "px");
    el.style.setProperty("--ff-cal-time-w", t.timeW + "px");
    el.style.setProperty("--ff-cal-hour-h", t.hourH + "px");
    el.style.setProperty("--ff-cal-half-h", t.halfH + "px");
    el.style.setProperty("--ff-cal-header-h", t.headerH + "px");
    el.style.setProperty("--ff-cal-axis-pad", t.axisPadTop + "px");
  }

  window.ffBookingCalLayout = {
    tokens: tokens,
    columnWidth: columnWidth,
    columnsWidth: columnsWidth,
    providerContentWidth: providerContentWidth,
    canvasWidth: canvasWidth,
    minutesToTop: minutesToTop,
    durationToHeight: durationToHeight,
    windowToRect: windowToRect,
    axisHeight: axisHeight,
    hourMarks: hourMarks,
    halfHourMarks: halfHourMarks,
    applyTokensToElement: applyTokensToElement
  };
})();
