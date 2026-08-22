/**
 * Booking Calendar sizing + ONE time-coordinate system.
 *
 * Y = axisPadTop + (minutesFromMidnight - axisStart) * (pixelsPerHour / 60)
 * height = durationMinutes * (pixelsPerHour / 60)
 * minutes = axisStart + (Y - axisPadTop) / (pixelsPerHour / 60)
 *
 * Provider width (one formula, any count):
 *   equal = availableSurface / providerCount
 *   column = equal >= minColW ? equal : minColW
 *   canvas = column * providerCount
 * Few providers fill the workspace. Many keep minColW and scroll.
 */
(function () {
  var TOKENS = Object.freeze({
    pixelsPerHour: 72,
    minColW: 144,
    timeW: 56,
    headerH: 44,
    axisPadTop: 8,
    snapMin: 15
  });

  function tokens() {
    var pxPerMinute = TOKENS.pixelsPerHour / 60;
    return {
      pixelsPerHour: TOKENS.pixelsPerHour,
      hourH: TOKENS.pixelsPerHour,
      quarterH: TOKENS.pixelsPerHour / 4,
      halfH: TOKENS.pixelsPerHour / 2,
      minColW: TOKENS.minColW,
      timeW: TOKENS.timeW,
      headerH: TOKENS.headerH,
      axisPadTop: TOKENS.axisPadTop,
      snapMin: TOKENS.snapMin,
      pxPerMinute: pxPerMinute
    };
  }

  function countOf(value) {
    return Math.max(0, Number(value) || 0);
  }

  function columnWidthFor(availableSurfaceWidth, employeeCount) {
    var n = countOf(employeeCount);
    var available = Math.max(0, Number(availableSurfaceWidth) || 0);
    if (!n) return TOKENS.minColW;
    var equal = available / n;
    return equal >= TOKENS.minColW ? equal : TOKENS.minColW;
  }

  function canvasWidth(availableSurfaceWidth, employeeCount) {
    var n = countOf(employeeCount);
    var available = Math.max(0, Number(availableSurfaceWidth) || 0);
    if (!n) return available;
    return columnWidthFor(available, n) * n;
  }

  function columnsWidth(availableSurfaceWidth, employeeCount) {
    return canvasWidth(availableSurfaceWidth, employeeCount);
  }

  function minutesToTop(absMinutes, axisStartMin) {
    var t = tokens();
    return t.axisPadTop + (Number(absMinutes) - Number(axisStartMin)) * t.pxPerMinute;
  }

  function durationToHeight(durationMinutes) {
    return Number(durationMinutes) * tokens().pxPerMinute;
  }

  function yToMinutes(y, axisStartMin) {
    var t = tokens();
    return Number(axisStartMin) + (Number(y) - t.axisPadTop) / t.pxPerMinute;
  }

  function snapMinutes(absMinutes, step) {
    var snap = Number(step) || TOKENS.snapMin;
    if (!(snap > 0)) return Number(absMinutes);
    return Math.round(Number(absMinutes) / snap) * snap;
  }

  function yToSlotStart(y, axisStartMin) {
    var snap = TOKENS.snapMin;
    return Math.floor(yToMinutes(y, axisStartMin) / snap) * snap;
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
    return tokens().axisPadTop + durationToHeight(Number(axisEndMin) - Number(axisStartMin));
  }

  function stepMarks(axisStartMin, axisEndMin, step, inclusiveEnd) {
    var start = Math.ceil(Number(axisStartMin) / step) * step;
    var end = Number(axisEndMin);
    var marks = [];
    var last = inclusiveEnd ? end : end - 0.0001;
    for (var m = start; m <= last; m += step) marks.push(m);
    return marks;
  }

  function hourMarks(axisStartMin, axisEndMin) {
    return stepMarks(axisStartMin, axisEndMin, 60, true);
  }

  function halfHourMarks(axisStartMin, axisEndMin) {
    return stepMarks(axisStartMin, axisEndMin, 30, false).filter(function (m) {
      return m % 60 !== 0;
    });
  }

  function quarterMarks(axisStartMin, axisEndMin) {
    return stepMarks(axisStartMin, axisEndMin, 15, false).filter(function (m) {
      return m % 30 !== 0;
    });
  }

  function markKind(absMinutes) {
    var q = ((Number(absMinutes) % 60) + 60) % 60;
    if (q === 0) return "hour";
    if (q === 30) return "half";
    return "quarter";
  }

  function hitTest(surfaceX, surfaceY, spec) {
    if (!spec || !spec.axis) return null;
    var employees = spec.employees || [];
    var colW = Number(spec.columnWidth);
    var n = employees.length;
    if (!n || !(colW > 0)) return null;
    var index = Math.floor(Number(surfaceX) / colW);
    if (index < 0 || index >= n) return null;
    var startMin = yToSlotStart(surfaceY, spec.axis.startMin);
    if (startMin < spec.axis.startMin || startMin >= spec.axis.endMin) return null;
    var emp = employees[index];
    return {
      providerId: emp && emp.id ? emp.id : "",
      dateKey: spec.dateKey || "",
      startMin: startMin
    };
  }

  function applyTokensToElement(el) {
    if (!el || !el.style) return;
    var t = tokens();
    el.style.setProperty("--ff-cal-min-col-w", t.minColW + "px");
    el.style.setProperty("--ff-cal-time-w", t.timeW + "px");
    el.style.setProperty("--ff-cal-hour-h", t.hourH + "px");
    el.style.setProperty("--ff-cal-half-h", t.halfH + "px");
    el.style.setProperty("--ff-cal-quarter-h", t.quarterH + "px");
    el.style.setProperty("--ff-cal-header-h", t.headerH + "px");
    el.style.setProperty("--ff-cal-axis-pad", t.axisPadTop + "px");
  }

  window.ffBookingCalLayout = {
    tokens: tokens,
    columnWidthFor: columnWidthFor,
    columnsWidth: columnsWidth,
    canvasWidth: canvasWidth,
    minutesToTop: minutesToTop,
    timeToY: minutesToTop,
    durationToHeight: durationToHeight,
    minutesToHeight: durationToHeight,
    yToMinutes: yToMinutes,
    yToTime: yToMinutes,
    yToSlotStart: yToSlotStart,
    snapMinutes: snapMinutes,
    windowToRect: windowToRect,
    axisHeight: axisHeight,
    hourMarks: hourMarks,
    halfHourMarks: halfHourMarks,
    quarterMarks: quarterMarks,
    markKind: markKind,
    hitTest: hitTest,
    applyTokensToElement: applyTokensToElement
  };
})();
