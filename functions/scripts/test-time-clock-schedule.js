/**
 * Offline unit tests for functions/time-clock-schedule.js (S0).
 * Run: node functions/scripts/test-time-clock-schedule.js
 */
"use strict";

const assert = require("assert");
const sched = require("../time-clock-schedule");

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log("PASS:", name);
  } else {
    failures += 1;
    console.log("FAIL:", name, extra || "");
  }
}

function almostEqual(a, b, tolMs) {
  return Math.abs(a - b) <= (tolMs == null ? 0 : tolMs);
}

// ── TZ normalize / fallback ──────────────────────────────────────────────────
check("DEFAULT_TZ is America/New_York", sched.DEFAULT_TZ === "America/New_York");
check("empty tz → New_York", sched.normalizeTimeZone("") === "America/New_York");
check("invalid tz → New_York", sched.normalizeTimeZone("Not/AZone") === "America/New_York");
check("valid tz preserved", sched.normalizeTimeZone("America/Los_Angeles") === "America/Los_Angeles");

// ── salonDateKey across zones ────────────────────────────────────────────────
// 2026-08-05 04:30 UTC = 2026-08-05 00:30 EDT (NY) = 2026-08-04 21:30 PDT (LA)
const utcInstant = Date.parse("2026-08-05T04:30:00.000Z");
check(
  "salonDateKey NY on UTC morning",
  sched.salonDateKey(new Date(utcInstant), "America/New_York") === "2026-08-05",
  sched.salonDateKey(new Date(utcInstant), "America/New_York"),
);
check(
  "salonDateKey LA still previous evening",
  sched.salonDateKey(new Date(utcInstant), "America/Los_Angeles") === "2026-08-04",
  sched.salonDateKey(new Date(utcInstant), "America/Los_Angeles"),
);

// ── wall time → UTC (EDT = UTC-4 in August) ──────────────────────────────────
const startMs = sched.zonedWallTimeToUtcMs("2026-08-05", "09:00", "America/New_York");
check(
  "09:00 America/New_York in August → 13:00Z",
  startMs === Date.parse("2026-08-05T13:00:00.000Z"),
  new Date(startMs).toISOString(),
);
const startLa = sched.zonedWallTimeToUtcMs("2026-08-05", "09:00", "America/Los_Angeles");
check(
  "09:00 America/Los_Angeles in August → 16:00Z",
  startLa === Date.parse("2026-08-05T16:00:00.000Z"),
  new Date(startLa).toISOString(),
);

// Round-trip: convert then localParts should match
const rt = sched.localParts(new Date(startMs), "America/New_York");
check("round-trip dateKey", rt.dateKey === "2026-08-05");
check("round-trip minutes", rt.minutes === 9 * 60);

// ── week start ───────────────────────────────────────────────────────────────
check(
  "week start monday for Wed 2026-08-05",
  sched.weekStartKeyFromDateKey("2026-08-05", "monday") === "2026-08-03",
);
check(
  "week start sunday for Wed 2026-08-05",
  sched.weekStartKeyFromDateKey("2026-08-05", "sunday") === "2026-08-02",
);
check(
  "week start monday for Sunday",
  sched.weekStartKeyFromDateKey("2026-08-09", "monday") === "2026-08-03",
);

// ── publish doc id ───────────────────────────────────────────────────────────
check("publish doc default → weeks", sched.schedulePublishDocId("default") === "weeks");
check("publish doc empty → weeks", sched.schedulePublishDocId("") === "weeks");
check("publish doc loc → weeks_loc", sched.schedulePublishDocId("loc_abc") === "weeks_loc_abc");

// ── settings normalize ───────────────────────────────────────────────────────
const def = sched.normalizeScheduleEnforcement(null);
check("defaults: enabled false", def.enabled === false);
check("defaults: noShiftPolicy allow", def.noShiftPolicy === "allow");
check("defaults: early 15", def.earlyClockInMinutes === 15);
check("defaults: late 15", def.lateClockOutMinutes === 15);

const on = sched.normalizeScheduleEnforcement({
  enabled: true,
  earlyClockInMinutes: 30,
  lateClockOutMinutes: 45,
  noShiftPolicy: "block",
});
check("enabled true only when explicit", on.enabled === true);
check("block policy", on.noShiftPolicy === "block");
check("early 30", on.earlyClockInMinutes === 30);
check("late 45", on.lateClockOutMinutes === 45);

// ── find assignment ──────────────────────────────────────────────────────────
const weekBlock = {
  days: [
    {
      date: "2026-08-05",
      assignments: [
        { staffId: "staff_a", startTime: "09:00", endTime: "17:00", name: "A" },
        { staffId: "staff_b", uid: "uid_b", startTime: "10:00", endTime: "14:00" },
      ],
    },
  ],
};
const found = sched.findAssignmentInWeekBlock(weekBlock, "2026-08-05", "staff_a");
check("find by staffId", found && found.startTime === "09:00" && found.endTime === "17:00");
check("linkedShiftId synthetic", found && found.linkedShiftId === "staff_a::2026-08-05");
check(
  "find by uid fallback",
  !!sched.findAssignmentInWeekBlock(weekBlock, "2026-08-05", "uid_b"),
);
check(
  "no shift → null",
  sched.findAssignmentInWeekBlock(weekBlock, "2026-08-05", "nobody") === null,
);
check(
  "wrong day → null",
  sched.findAssignmentInWeekBlock(weekBlock, "2026-08-06", "staff_a") === null,
);

// Overnight rejected
check(
  "overnight assignment rejected",
  sched.findAssignmentInWeekBlock({
    days: [{ date: "2026-08-05", assignments: [
      { staffId: "x", startTime: "22:00", endTime: "06:00" },
    ] }],
  }, "2026-08-05", "x") === null,
);

// ── publish gate ─────────────────────────────────────────────────────────────
check(
  "isWeekPublished true",
  sched.isWeekPublished({ published: { "2026-08-03": true } }, "2026-08-03") === true,
);
check(
  "isWeekPublished false when missing",
  sched.isWeekPublished({ published: {} }, "2026-08-03") === false,
);

// ── clock-in evaluation ──────────────────────────────────────────────────────
const enf = sched.normalizeScheduleEnforcement({
  enabled: true,
  earlyClockInMinutes: 15,
  lateClockOutMinutes: 15,
  noShiftPolicy: "allow",
});
const shift = {
  dateKey: "2026-08-05",
  startTime: "09:00",
  endTime: "17:00",
  linkedShiftId: "staff_a::2026-08-05",
};
// Shift start 13:00Z; allowed from 12:45Z
const tooEarly = sched.evaluateScheduleClockIn({
  enforcement: enf,
  weekPublished: true,
  shift,
  nowMs: Date.parse("2026-08-05T12:30:00.000Z"),
  timeZone: "America/New_York",
});
check("too early blocked", tooEarly.ok === false && tooEarly.reason === "too_early_for_shift");
check("allowedAt ISO present", typeof tooEarly.allowedAt === "string");
check(
  "allowedAt ≈ 12:45Z",
  almostEqual(Date.parse(tooEarly.allowedAt), Date.parse("2026-08-05T12:45:00.000Z"), 0),
  tooEarly.allowedAt,
);
check("snapshot start/end on reject", tooEarly.linkedShiftStart === "09:00" && tooEarly.linkedShiftEnd === "17:00");

const onTime = sched.evaluateScheduleClockIn({
  enforcement: enf,
  weekPublished: true,
  shift,
  nowMs: Date.parse("2026-08-05T12:45:00.000Z"),
  timeZone: "America/New_York",
});
check("at window edge allowed", onTime.ok === true && onTime.scheduled === true);
check("snapshot fields on allow", onTime.linkedShiftId === "staff_a::2026-08-05");

const unpublished = sched.evaluateScheduleClockIn({
  enforcement: enf,
  weekPublished: false,
  shift,
  nowMs: Date.parse("2026-08-05T10:00:00.000Z"),
  timeZone: "America/New_York",
});
check("unpublished week → no enforce", unpublished.enforce === false && unpublished.ok === true);

const noShiftAllow = sched.evaluateScheduleClockIn({
  enforcement: enf,
  weekPublished: true,
  shift: null,
  nowMs: Date.parse("2026-08-05T13:00:00.000Z"),
  timeZone: "America/New_York",
});
check("no shift + allow → ok unscheduled", noShiftAllow.ok === true && noShiftAllow.scheduled === false);

const enfBlock = sched.normalizeScheduleEnforcement({
  enabled: true,
  earlyClockInMinutes: 15,
  lateClockOutMinutes: 15,
  noShiftPolicy: "block",
});
const noShiftBlock = sched.evaluateScheduleClockIn({
  enforcement: enfBlock,
  weekPublished: true,
  shift: null,
  nowMs: Date.parse("2026-08-05T13:00:00.000Z"),
  timeZone: "America/New_York",
});
check("no shift + block → reject", noShiftBlock.ok === false && noShiftBlock.reason === "no_scheduled_shift");

const disabled = sched.evaluateScheduleClockIn({
  enforcement: sched.normalizeScheduleEnforcement({ enabled: false }),
  weekPublished: true,
  shift,
  nowMs: Date.parse("2026-08-05T10:00:00.000Z"),
  timeZone: "America/New_York",
});
check("enforcement off → always ok", disabled.ok === true && disabled.enforce === false);

// ── clock-out late flag (snapshot) ───────────────────────────────────────────
const late = sched.evaluateScheduleClockOut({
  enforcement: enf,
  scheduled: true,
  linkedShiftEnd: "17:00",
  linkedShiftStart: "09:00",
  dateKey: "2026-08-05",
  nowMs: Date.parse("2026-08-05T21:20:00.000Z"), // 17:20 EDT
  timeZone: "America/New_York",
});
check("late clock-out flagged", late.lateClockOutFlag === true && late.reason === "past_schedule");

const onTimeOut = sched.evaluateScheduleClockOut({
  enforcement: enf,
  scheduled: true,
  linkedShiftEnd: "17:00",
  dateKey: "2026-08-05",
  nowMs: Date.parse("2026-08-05T21:10:00.000Z"), // 17:10 EDT — within Y=15
  timeZone: "America/New_York",
});
check("within late window → no flag", onTimeOut.lateClockOutFlag === false);

const unscheduledOut = sched.evaluateScheduleClockOut({
  enforcement: enf,
  scheduled: false,
  linkedShiftEnd: "17:00",
  dateKey: "2026-08-05",
  nowMs: Date.parse("2026-08-05T23:00:00.000Z"),
  timeZone: "America/New_York",
});
check("unscheduled entry → no late flag", unscheduledOut.lateClockOutFlag === false);

// Snapshot is source of truth: live schedule change would not matter — we only
// read linkedShiftEnd/dateKey (S2 contract).
const snapshotOnly = sched.evaluateScheduleClockOut({
  enforcement: enf,
  scheduled: true,
  linkedShiftEnd: "12:00",
  dateKey: "2026-08-05",
  // 16:00 EDT ≫ 12:00 + 15m window
  nowMs: Date.parse("2026-08-05T20:00:00.000Z"),
  timeZone: "America/New_York",
});
check("S2 snapshot end drives late flag", snapshotOnly.lateClockOutFlag === true);

// S5: publish gate + defaults still hold under enforcement-on payloads.
const pubGate = sched.evaluateScheduleClockIn({
  enforcement: sched.normalizeScheduleEnforcement({
    enabled: true,
    earlyClockInMinutes: 0,
    lateClockOutMinutes: 0,
    noShiftPolicy: "block",
  }),
  weekPublished: false,
  shift,
  nowMs: Date.parse("2026-08-05T10:00:00.000Z"),
  timeZone: "America/New_York",
});
check("S5 unpublished week never blocks", pubGate.ok === true && pubGate.enforce === false);

const defPolicy = sched.normalizeScheduleEnforcement({ enabled: true });
check("S5 default noShiftPolicy remains allow", defPolicy.noShiftPolicy === "allow");

// Device TZ must not affect enforcement: same absolute nowMs + salon TZ → same
// decision whether the Node process thinks it is in Costa Rica or New York.
const priorTz = process.env.TZ;
const shiftNy = {
  dateKey: "2026-08-05",
  startTime: "09:00",
  endTime: "17:00",
  linkedShiftId: "s::2026-08-05",
};
const enfNy = sched.normalizeScheduleEnforcement({
  enabled: true,
  earlyClockInMinutes: 15,
  lateClockOutMinutes: 15,
  noShiftPolicy: "allow",
});
const nowEarlyUtc = Date.parse("2026-08-05T12:30:00.000Z"); // 08:30 EDT
process.env.TZ = "America/Costa_Rica";
const fromCr = sched.evaluateScheduleClockIn({
  enforcement: enfNy,
  weekPublished: true,
  shift: shiftNy,
  nowMs: nowEarlyUtc,
  timeZone: "America/New_York",
});
process.env.TZ = "America/New_York";
const fromNy = sched.evaluateScheduleClockIn({
  enforcement: enfNy,
  weekPublished: true,
  shift: shiftNy,
  nowMs: nowEarlyUtc,
  timeZone: "America/New_York",
});
if (priorTz == null) delete process.env.TZ;
else process.env.TZ = priorTz;

check(
  "device TZ Costa Rica vs NY: same too_early decision",
  fromCr.ok === false && fromNy.ok === false
    && fromCr.reason === "too_early_for_shift"
    && fromNy.reason === "too_early_for_shift",
);
check(
  "device TZ does not change allowedAt",
  fromCr.allowedAt === fromNy.allowedAt
    && fromCr.allowedAt === "2026-08-05T12:45:00.000Z",
  { fromCr: fromCr.allowedAt, fromNy: fromNy.allowedAt },
);
check(
  "salonDateKey ignores process TZ (NY calendar day)",
  sched.salonDateKey(new Date(nowEarlyUtc), "America/New_York") === "2026-08-05",
);

console.log("");
if (failures) {
  console.error(`FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("All S0/S2/S5 time-clock-schedule checks passed.");
process.exit(0);
