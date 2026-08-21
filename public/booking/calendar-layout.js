/**
 * Booking Calendar geometry tokens and positioning.
 * Appointments later should use minutesToTop / windowToRect — not new pixel math.
 */
(function () {
  var COL_W = 176;
  var TIME_W = 72;
  var HOUR_H = 64;
  var HEADER_H = 48;
  var SNAP_MIN = 15;

  function tokens() {
    return {
      colW: COL_W,
      timeW: TIME_W,
      hourH: HOUR_H,
      headerH: HEADER_H,
      snapMin: SNAP_MIN,
      pxPerMinute: HOUR_H / 60
    };
  }

  function minutesToTop(absMinutes, axisStartMin) {
    return (Number(absMinutes) - Number(axisStartMin)) * tokens().pxPerMinute;
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
    return Math.max(0, (Number(axisEndMin) - Number(axisStartMin)) * tokens().pxPerMinute);
  }

  function hourMarks(axisStartMin, axisEndMin) {
    var start = Math.ceil(Number(axisStartMin) / 60) * 60;
    var marks = [];
    for (var m = start; m <= Number(axisEndMin); m += 60) marks.push(m);
    return marks;
  }

  window.ffBookingCalLayout = {
    tokens: tokens,
    minutesToTop: minutesToTop,
    windowToRect: windowToRect,
    axisHeight: axisHeight,
    hourMarks: hourMarks
  };
})();
