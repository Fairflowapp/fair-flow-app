/**
 * Time Clock Engine — Stage 5 foundation
 * ======================================
 *
 * Tiny pure helper that turns a weekly hours total into a
 * { regularHours, overtimeHours } breakdown using the rules in
 * `salons/{salonId}/settings/timeClock`.
 *
 * Scope (intentionally narrow for this stage):
 *   - WEEKLY overtime only.
 *   - No daily overtime split.
 *   - No double-time.
 *   - No pay / earnings math.
 *   - No side effects: does not read Firestore, does not touch the DOM,
 *     does not cache. Callers pass the settings object in.
 *
 * This lives in its own file (not settings-cloud.js / not index.html) so the
 * eventual timesheet / payroll modules can import it cleanly and so unit
 * testing it later stays easy.
 *
 * Test cases (run in devtools via: window.ffTimeClockEngineSelfTest())
 *   1) 32h, overtime enabled, weeklyThreshold 40 → regular 32, overtime 0
 *   2) 40h, overtime enabled, weeklyThreshold 40 → regular 40, overtime 0
 *   3) 46h, overtime enabled, weeklyThreshold 40 → regular 40, overtime 6
 *   4) 46h, overtime disabled                    → regular 46, overtime 0
 *   Extra edge cases also covered by the self-test:
 *     0h / negative / NaN input, missing settings object, threshold 0,
 *     threshold bigger than worked hours.
 */
(function () {
  'use strict';

  // Fallback threshold if the settings object is missing or malformed.
  // Matches the default used by ffNormalizeTimeClockSettings in settings-cloud.js.
  var FF_TC_DEFAULT_WEEKLY_THRESHOLD = 40;

  /**
   * Coerce any value to a finite, non-negative number. Used for both the
   * hours input and the threshold so the helper never returns NaN.
   */
  function _ffToNonNegNumber(v, fallback) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return (fallback != null ? fallback : 0);
    return n;
  }

  /**
   * ffComputeWeeklyHoursBreakdown(totalWorkedHours, timeClockSettings)
   *
   * @param {number} totalWorkedHours  - Hours worked in the workweek. Any
   *                                     value < 0 or non-numeric is treated
   *                                     as 0.
   * @param {object} timeClockSettings - Same shape as the Firestore doc
   *                                     salons/{salonId}/settings/timeClock:
   *                                     { overtime: { enabled, weeklyThreshold } }
   *                                     Extra fields are ignored.
   * @returns {{regularHours:number, overtimeHours:number}}
   */
  function ffComputeWeeklyHoursBreakdown(totalWorkedHours, timeClockSettings) {
    var total = _ffToNonNegNumber(totalWorkedHours, 0);

    var ot =
      (timeClockSettings && typeof timeClockSettings === 'object' && timeClockSettings.overtime)
        ? timeClockSettings.overtime
        : null;

    // Overtime disabled OR settings missing → everything is regular.
    if (!ot || ot.enabled !== true) {
      return { regularHours: total, overtimeHours: 0 };
    }

    var threshold = _ffToNonNegNumber(ot.weeklyThreshold, FF_TC_DEFAULT_WEEKLY_THRESHOLD);

    if (total <= threshold) {
      return { regularHours: total, overtimeHours: 0 };
    }
    return {
      regularHours: threshold,
      overtimeHours: total - threshold,
    };
  }

  /**
   * Convert a start/end value to milliseconds since epoch.
   * Accepts: Date instance, numeric timestamp (ms), or ISO / date-time string.
   * Returns NaN if the value cannot be parsed so callers can skip the shift.
   */
  function _ffShiftBoundaryToMs(v) {
    if (v == null) return NaN;
    if (v instanceof Date) {
      var t = v.getTime();
      return isFinite(t) ? t : NaN;
    }
    if (typeof v === 'number') {
      return isFinite(v) ? v : NaN;
    }
    if (typeof v === 'string' && v.trim() !== '') {
      var parsed = Date.parse(v);
      return isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  }

  /**
   * ffComputeWeeklyShiftHoursSummary(shifts, timeClockSettings)
   *
   * Sums a list of shifts into a total hours number, then delegates the
   * regular/overtime split to ffComputeWeeklyHoursBreakdown.
   *
   * @param {Array<{start:any,end:any}>} shifts
   *        Each shift should have `start` and `end` as Date, number (ms) or
   *        a parseable string (e.g. ISO). Shifts missing either bound, or
   *        whose end is strictly before start, are silently skipped.
   *        A non-array input is treated as an empty list.
   * @param {object} timeClockSettings - Same shape as ffComputeWeeklyHoursBreakdown.
   * @returns {{totalWorkedHours:number, regularHours:number, overtimeHours:number}}
   */
  function ffComputeWeeklyShiftHoursSummary(shifts, timeClockSettings) {
    var list = Array.isArray(shifts) ? shifts : [];
    var totalMs = 0;

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || typeof s !== 'object') continue;
      var startMs = _ffShiftBoundaryToMs(s.start);
      var endMs = _ffShiftBoundaryToMs(s.end);
      // Skip if either bound failed to parse, or end is before start.
      // end === start yields 0ms and is harmless, but we allow it.
      if (!isFinite(startMs) || !isFinite(endMs)) continue;
      if (endMs < startMs) continue;
      totalMs += (endMs - startMs);
    }

    var totalWorkedHours = totalMs / (1000 * 60 * 60);
    var breakdown = ffComputeWeeklyHoursBreakdown(totalWorkedHours, timeClockSettings);
    return {
      totalWorkedHours: totalWorkedHours,
      regularHours: breakdown.regularHours,
      overtimeHours: breakdown.overtimeHours,
    };
  }

  /**
   * Dev-only self-test. Call window.ffTimeClockEngineSelfTest() in the
   * browser console to verify the engine still behaves as expected.
   * Returns true if all cases pass, false otherwise; logs details either way.
   * Not invoked automatically — zero impact on production.
   */
  function ffTimeClockEngineSelfTest() {
    var cases = [
      {
        label: '32h, OT enabled, threshold 40',
        input: [32, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 32, overtimeHours: 0 },
      },
      {
        label: '40h, OT enabled, threshold 40',
        input: [40, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 40, overtimeHours: 0 },
      },
      {
        label: '46h, OT enabled, threshold 40',
        input: [46, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 40, overtimeHours: 6 },
      },
      {
        label: '46h, OT disabled',
        input: [46, { overtime: { enabled: false, weeklyThreshold: 40 } }],
        expect: { regularHours: 46, overtimeHours: 0 },
      },
      {
        label: '0h, OT enabled',
        input: [0, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 0, overtimeHours: 0 },
      },
      {
        label: 'negative input → treated as 0',
        input: [-5, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 0, overtimeHours: 0 },
      },
      {
        label: 'NaN input → treated as 0',
        input: [NaN, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 0, overtimeHours: 0 },
      },
      {
        label: 'missing settings → treated as OT disabled',
        input: [46, null],
        expect: { regularHours: 46, overtimeHours: 0 },
      },
      {
        label: 'threshold 0, OT enabled → everything is OT',
        input: [8, { overtime: { enabled: true, weeklyThreshold: 0 } }],
        expect: { regularHours: 0, overtimeHours: 8 },
      },
      {
        label: 'threshold > worked hours → no OT',
        input: [30, { overtime: { enabled: true, weeklyThreshold: 40 } }],
        expect: { regularHours: 30, overtimeHours: 0 },
      },
    ];

    var passed = 0;
    var failed = 0;
    cases.forEach(function (c) {
      var out = ffComputeWeeklyHoursBreakdown(c.input[0], c.input[1]);
      var ok = out.regularHours === c.expect.regularHours && out.overtimeHours === c.expect.overtimeHours;
      if (ok) {
        passed++;
        console.log('%c PASS ', 'background:#10b981;color:#fff;padding:2px 6px;border-radius:3px;', c.label, out);
      } else {
        failed++;
        console.error('FAIL', c.label, '\n  expected:', c.expect, '\n  got:', out);
      }
    });

    // --- ffComputeWeeklyShiftHoursSummary cases ---
    // Helper to build a shift on a given day at whole-hour boundaries, so the
    // cases stay readable (Mon 2026-04-20 is arbitrary — only durations matter).
    function mk(dayOffset, startHour, endHour) {
      var base = new Date(2026, 3, 20); // Apr 20 2026, local time (month is 0-idx)
      var start = new Date(base); start.setDate(base.getDate() + dayOffset); start.setHours(startHour, 0, 0, 0);
      var end = new Date(base); end.setDate(base.getDate() + dayOffset); end.setHours(endHour, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    var otOn = { overtime: { enabled: true, weeklyThreshold: 40 } };
    var shiftCases = [
      {
        label: '5 shifts of 8h → total 40 / reg 40 / OT 0',
        input: [[mk(0,9,17), mk(1,9,17), mk(2,9,17), mk(3,9,17), mk(4,9,17)], otOn],
        expect: { totalWorkedHours: 40, regularHours: 40, overtimeHours: 0 },
      },
      {
        label: '5 shifts of 9h → total 45 / reg 40 / OT 5',
        input: [[mk(0,9,18), mk(1,9,18), mk(2,9,18), mk(3,9,18), mk(4,9,18)], otOn],
        expect: { totalWorkedHours: 45, regularHours: 40, overtimeHours: 5 },
      },
      {
        label: 'invalid shifts skipped (missing end, end<start, null entry)',
        input: [[mk(0,9,17), { start: '2026-04-21T09:00:00Z' /* no end */ }, { start: '2026-04-21T10:00:00Z', end: '2026-04-21T09:00:00Z' }, null], otOn],
        expect: { totalWorkedHours: 8, regularHours: 8, overtimeHours: 0 },
      },
      {
        label: 'empty array → all zeros',
        input: [[], otOn],
        expect: { totalWorkedHours: 0, regularHours: 0, overtimeHours: 0 },
      },
      {
        label: 'non-array input → treated as empty',
        input: [null, otOn],
        expect: { totalWorkedHours: 0, regularHours: 0, overtimeHours: 0 },
      },
      {
        label: '5 shifts of 9h, OT disabled → all regular',
        input: [[mk(0,9,18), mk(1,9,18), mk(2,9,18), mk(3,9,18), mk(4,9,18)], { overtime: { enabled: false, weeklyThreshold: 40 } }],
        expect: { totalWorkedHours: 45, regularHours: 45, overtimeHours: 0 },
      },
    ];
    shiftCases.forEach(function (c) {
      var out = ffComputeWeeklyShiftHoursSummary(c.input[0], c.input[1]);
      // Use a small epsilon for float compare on totalWorkedHours.
      var eps = 1e-9;
      var ok = Math.abs(out.totalWorkedHours - c.expect.totalWorkedHours) < eps
            && out.regularHours === c.expect.regularHours
            && out.overtimeHours === c.expect.overtimeHours;
      if (ok) {
        passed++;
        console.log('%c PASS ', 'background:#10b981;color:#fff;padding:2px 6px;border-radius:3px;', c.label, out);
      } else {
        failed++;
        console.error('FAIL', c.label, '\n  expected:', c.expect, '\n  got:', out);
      }
    });

    console.log('[ffTimeClockEngineSelfTest] passed=' + passed + ' failed=' + failed);
    return failed === 0;
  }

  // Expose only; no auto-run, no side effects.
  if (typeof window !== 'undefined') {
    window.ffComputeWeeklyHoursBreakdown = ffComputeWeeklyHoursBreakdown;
    window.ffComputeWeeklyShiftHoursSummary = ffComputeWeeklyShiftHoursSummary;
    window.ffTimeClockEngineSelfTest = ffTimeClockEngineSelfTest;
  }
})();
