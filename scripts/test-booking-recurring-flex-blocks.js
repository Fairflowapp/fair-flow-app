/**
 * Recurring + Flexible Time Blocks.
 * Usage: node scripts/test-booking-recurring-flex-blocks.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const createdNodes = [];
const docListeners = {};
const documentMock = {
  readyState: "complete",
  documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} },
  body: {
    classList: { add: function () {}, remove: function () {} },
    appendChild: function (el) { createdNodes.push(el); return el; }
  },
  addEventListener: function (type, fn) {
    (docListeners[type] || (docListeners[type] = [])).push(fn);
  },
  dispatchEvent: function () { return true; },
  getElementById: function (id) {
    return createdNodes.find(function (el) { return el.id === id; }) || null;
  },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) {
    return {
      tagName: String(tag || "").toUpperCase(),
      id: "",
      className: "",
      innerHTML: "",
      style: {},
      classList: { add: function () {}, remove: function () {}, toggle: function () {} },
      setAttribute: function (name, value) { if (name === "id") this.id = value; },
      removeAttribute: function () {},
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    };
  }
};

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, documentMock);
}

const weekly = {
  sunday: { isOpen: false },
  monday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  tuesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  wednesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  thursday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  friday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  saturday: { isOpen: true, openTime: "09:00", closeTime: "18:00" }
};

const windowObj = {
  addEventListener: function () {},
  currentSalonId: "salon1",
  settings: { businessHours: weekly },
  ffGetStaffStore: function () {
    return { staff: [{ id: "rebecca", name: "Rebecca", technicianTypes: ["nails"] }] };
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/availability.js", windowObj);
load("public/booking/blocks/model.js", windowObj);
load("public/booking/blocks/series-model.js", windowObj);
load("public/booking/blocks/flex-relocate.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/blocks/editor-recurrence.js", windowObj);
load("public/booking/blocks/editor.js", windowObj);
load("public/booking/smart-scheduling/normalize.js", windowObj);
load("public/booking/smart-scheduling/gaps.js", windowObj);
load("public/booking/smart-scheduling/candidates.js", windowObj);
load("public/booking/smart-scheduling/score.js", windowObj);
load("public/booking/smart-scheduling/engine.js", windowObj);
load("public/booking/smart-scheduling/flex-time-blocks.js", windowObj);

const model = windowObj.ffBookingBlockModel;
const series = windowObj.ffBookingBlockSeriesModel;
const flex = windowObj.ffBookingFlexRelocate;
const blocks = windowObj.ffBookingCalBlocks;
const editor = windowObj.ffBookingBlockEditor;
const recUi = windowObj.ffBookingBlockEditorRecurrence;
const drop = windowObj.ffBookingCalDrop;
const engine = windowObj.ffBookingAvailability;
const ss = windowObj.ffBookingSmartScheduling;
const layout = windowObj.ffBookingCalLayout;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const WEEK = [
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
  "2026-09-25", "2026-09-26", "2026-09-27"
];

function lunchSeries(extra) {
  return series.normalizeSeries(Object.assign({
    seriesId: "serLunch",
    providerId: "rebecca",
    locationId: "loc1",
    reason: "lunch",
    note: "",
    preferredStartMin: 14 * 60,
    durationMinutes: 30,
    repeatFrequency: "weekdays",
    startDateKey: "2026-09-21",
    flexibilityMode: "flexible",
    earliestStartMin: 13 * 60,
    latestEndMin: 15 * 60 + 30
  }, extra || {}));
}

function occ(dateKey, exception) {
  return series.occurrenceFrom(lunchSeries(), dateKey, exception);
}

const oneOff = model.normalize({
  blockId: "blk_one",
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-09-21",
  startMin: 14 * 60,
  endMin: 14 * 60 + 30,
  reason: "lunch",
  note: "FF-QA one-off"
});

check("1. non-repeating Time Block unchanged", !!(
  oneOff && oneOff.reason === "lunch"
  && oneOff.startMin === 14 * 60 && oneOff.endMin === 14 * 60 + 30
  && oneOff.flexibilityMode === "fixed" && !oneOff.seriesId && !oneOff.isOccurrence
));

const daily = series.normalizeSeries(Object.assign({}, lunchSeries(), {
  seriesId: "serDaily",
  repeatFrequency: "daily",
  startDateKey: "2026-09-21",
  endDateKey: "2026-09-27"
}));
const dailyOcc = series.generateOccurrences([daily], WEEK, []);
check("2. Every Day recurrence", dailyOcc.length === 7 && dailyOcc.every(function (row) {
  return row.startMin === 14 * 60 && row.endMin === 14 * 60 + 30;
}));

const weekdaysOcc = series.generateOccurrences([lunchSeries()], WEEK, []);
check("3. Weekdays recurrence", weekdaysOcc.length === 5
  && weekdaysOcc.map(function (row) { return row.dateKey; }).join(",") === WEEK.slice(0, 5).join(","));
check("3b. weekend excluded from weekdays", weekdaysOcc.every(function (row) {
  return series.weekdayOf(row.dateKey) >= 1 && series.weekdayOf(row.dateKey) <= 5;
}));

const custom = series.normalizeSeries(Object.assign({}, lunchSeries(), {
  seriesId: "serCustom",
  repeatFrequency: "custom",
  daysOfWeek: [1, 3, 5]
}));
const customOcc = series.generateOccurrences([custom], WEEK, []);
check("4. custom weekdays", customOcc.map(function (row) { return row.dateKey; }).join(",") === "2026-09-21,2026-09-23,2026-09-25");

const lateStart = series.normalizeSeries(Object.assign({}, lunchSeries(), {
  seriesId: "serStart",
  startDateKey: "2026-09-23"
}));
check("5. series start date", series.generateOccurrences([lateStart], WEEK, []).map(function (row) {
  return row.dateKey;
}).join(",") === "2026-09-23,2026-09-24,2026-09-25");

const earlyEnd = series.normalizeSeries(Object.assign({}, lunchSeries(), {
  seriesId: "serEnd",
  endDateKey: "2026-09-22"
}));
check("6. series end date", series.generateOccurrences([earlyEnd], WEEK, []).map(function (row) {
  return row.dateKey;
}).join(",") === "2026-09-21,2026-09-22");

const first = series.generateOccurrences([lunchSeries()], WEEK, []);
const second = series.generateOccurrences([lunchSeries()], WEEK, []);
check("7. no duplicate occurrences after reload", first.length === second.length
  && first.map(function (row) { return row.blockId; }).join("|") === second.map(function (row) { return row.blockId; }).join("|")
  && new Set(first.map(function (row) { return row.blockId; })).size === first.length);

const dayOcc = series.generateOccurrences([lunchSeries()], ["2026-09-23"], []);
check("8. Day View shows correct occurrence", dayOcc.length === 1 && dayOcc[0].dateKey === "2026-09-23"
  && dayOcc[0].startMin === 14 * 60);

blocks.setAll(weekdaysOcc.concat([oneOff]));
check("9. Week View shows correct occurrences", WEEK.filter(function (day) {
  return blocks.forView(day, "loc1").some(function (row) { return row.seriesId === "serLunch"; });
}).join(",") === WEEK.slice(0, 5).join(","));
check("10. provider filters work", blocks.forProvider("2026-09-23", "loc1", "rebecca").length === 1
  && blocks.forProvider("2026-09-23", "loc1", "ashley").length === 0);

const wedMoved = series.occurrenceFrom(lunchSeries(), "2026-09-23", {
  seriesId: "serLunch",
  occurrenceDateKey: "2026-09-23",
  kind: "override",
  startMin: 13 * 60 + 30,
  endMin: 14 * 60
});
const afterEdit = series.generateOccurrences([lunchSeries()], WEEK, [{
  seriesId: "serLunch",
  occurrenceDateKey: "2026-09-23",
  kind: "override",
  startMin: 13 * 60 + 30,
  endMin: 14 * 60
}]);
check("11. edit one occurrence does not change the whole series", wedMoved.startMin === 13 * 60 + 30
  && afterEdit.filter(function (row) { return row.dateKey !== "2026-09-23"; }).every(function (row) {
    return row.startMin === 14 * 60;
  }));
check("12. move one occurrence preserves future preferred time", afterEdit.find(function (row) {
  return row.dateKey === "2026-09-24";
}).startMin === 14 * 60);

const afterDelete = series.generateOccurrences([lunchSeries()], WEEK, [{
  seriesId: "serLunch",
  occurrenceDateKey: "2026-09-23",
  kind: "skip"
}]);
check("13. delete one occurrence preserves future occurrences", afterDelete.every(function (row) {
  return row.dateKey !== "2026-09-23";
}) && afterDelete.some(function (row) { return row.dateKey === "2026-09-24"; }));
check("14. reload restores occurrence override", afterEdit.find(function (row) {
  return row.dateKey === "2026-09-23";
}).isOverride === true && afterEdit.find(function (row) {
  return row.dateKey === "2026-09-23";
}).startMin === 13 * 60 + 30);

const fixed = model.normalize({
  blockId: "blk_fixed",
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-09-21",
  startMin: 14 * 60,
  endMin: 14 * 60 + 30,
  reason: "lunch",
  flexibilityMode: "fixed"
});
const flexible = occ("2026-09-21");
check("15. Fixed block remains hard unavailable time", flex.classifyBlock(fixed) === "hard"
  && flex.findRelocation(fixed, { startMin: 14 * 60, endMin: 15 * 60 }, {
    appointments: [],
    blocks: [fixed],
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  }).ok === false);
check("16. Flexible block exposes preferred time", flexible.preferredStartMin === 14 * 60
  && flex.preferredStart(flexible) === 14 * 60);
check("17. Flexible block exposes allowed window", flex.windowOf(flexible).earliestStartMin === 13 * 60
  && flex.windowOf(flexible).latestEndMin === 15 * 60 + 30);
check("18. required duration never shrinks", flex.requiredDuration(flexible) === 30
  && flex.findRelocation(flexible, { startMin: 14 * 60, endMin: 15 * 60 }, {
    appointments: [],
    blocks: [flexible],
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  }).durationMinutes === 30);

const laterFit = flex.findRelocation(flexible, { startMin: 14 * 60, endMin: 15 * 60 }, {
  appointments: [],
  blocks: [flexible],
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
});
check("19. overlapping appointment can use preferred slot if alternative break exists", laterFit.ok === true && laterFit.moved === true);
check("20. closest valid placement is earlier when both sides are free", laterFit.startMin === 13 * 60 + 30 && laterFit.endMin === 14 * 60);

const earlierFit = flex.findRelocation(flexible, { startMin: 14 * 60, endMin: 15 * 60 }, {
  appointments: [{ appointmentId: "busy", startMin: 14 * 60, endMin: 16 * 60 }],
  blocks: [flexible],
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
});
check("20b. block moves to valid earlier time when later is full", earlierFit.ok === true && earlierFit.startMin === 13 * 60 + 30);

const packed = flex.tryFitAppointment({
  startMin: 14 * 60,
  endMin: 15 * 60
}, {
  appointments: [
    { appointmentId: "a1", startMin: 13 * 60, endMin: 14 * 60 },
    { appointmentId: "a2", startMin: 14 * 60 + 30, endMin: 18 * 60 }
  ],
  blocks: [flexible],
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
});
check("22. no valid alternative => appointment is rejected", packed.ok === false);

const offHours = flex.findRelocation(flexible, { startMin: 14 * 60, endMin: 15 * 60 }, {
  appointments: [],
  blocks: [flexible],
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }]
});
check("23. provider availability is respected", offHours.ok === false);

const withFixed = flex.tryFitAppointment({ startMin: 14 * 60, endMin: 15 * 60 }, {
  appointments: [],
  blocks: [flexible, Object.assign({}, fixed, { blockId: "otherFixed", startMin: 15 * 60, endMin: 15 * 60 + 30 })],
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
});
check("24. Fixed blocks are respected", withFixed.ok === true && withFixed.relocations[0].toStartMin === 13 * 60 + 30);

const withAppt = flex.findRelocation(flexible, { startMin: 14 * 60, endMin: 15 * 60 }, {
  appointments: [{ appointmentId: "keep", startMin: 13 * 60, endMin: 14 * 60 }],
  blocks: [flexible],
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
});
check("21. block moves to valid later time", withAppt.ok === true && withAppt.startMin === 15 * 60);
check("25. other appointments are respected", withAppt.ok === true && withAppt.startMin === 15 * 60);

check("26. engine distinguishes Fixed vs Flexible", ss.classifyTimeBlock(fixed) === "hard"
  && ss.classifyTimeBlock(flexible) === "movable");

const day = ss.normalizeProviderDay({
  dateKey: "2026-09-21",
  locationId: "loc1",
  providerId: "rebecca",
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
  lines: [{ lineId: "busy", appointmentId: "busy", providerId: "rebecca", startMin: 13 * 60, endMin: 14 * 60, status: "scheduled" }],
  allowedOverlapMinutes: 0
});
day.timeBlocks = [flexible];
const ranked = ss.rankSlotsWithFlexibleBlocks(day, { durationMinutes: 60 });
const twoPm = ranked.find(function (slot) { return slot.startMin === 14 * 60; });
check("27. relocation recommendation contains old/new time", !!(twoPm && twoPm.flexibleRelocations
  && twoPm.flexibleRelocations[0]
  && twoPm.flexibleRelocations[0].fromStartMin === 14 * 60
  && twoPm.flexibleRelocations[0].toStartMin === 15 * 60));
const keepPreferred = ranked.find(function (slot) { return slot.startMin === 11 * 60; });
check("28. closest valid placement is preferred", !!(twoPm && twoPm.flexibleRelocations[0].toStartMin === 15 * 60
  && keepPreferred && keepPreferred.keepsPreferredBreak));
check("29. no automatic deletion", twoPm.flexibleRelocations[0].durationMinutes === 30
  && twoPm.flexibleRelocations[0].toEndMin - twoPm.flexibleRelocations[0].toStartMin === 30);
check("30. required break duration preserved", laterFit.durationMinutes === 30
  && laterFit.endMin - laterFit.startMin === 30);

const exceptions = {};
function saveBooking(incoming) {
  const plan = flex.tryFitAppointment(incoming, {
    appointments: incoming.existingAppointments || [],
    blocks: [occ("2026-09-21")],
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  });
  if (!plan.ok) return { ok: false, appointment: null };
  const appointment = { startMin: incoming.startMin, endMin: incoming.endMin, saved: true };
  (plan.relocations || []).forEach(function (move) {
    exceptions[move.occurrenceDateKey] = {
      seriesId: "serLunch",
      occurrenceDateKey: move.occurrenceDateKey,
      kind: "override",
      startMin: move.toStartMin,
      endMin: move.toEndMin
    };
  });
  return { ok: true, appointment: appointment, relocations: plan.relocations };
}

const saved = saveBooking({ startMin: 14 * 60, endMin: 15 * 60 });
const savedOcc = series.generateOccurrences([lunchSeries()], WEEK, Object.keys(exceptions).map(function (key) {
  return exceptions[key];
}));
const savedLunch = savedOcc.find(function (row) { return row.dateKey === "2026-09-21"; });
check("31. appointment + moved occurrence remain consistent", saved.ok === true
  && saved.appointment.saved === true
  && savedLunch
  && savedLunch.startMin !== 14 * 60
  && (saved.appointment.endMin <= savedLunch.startMin || saved.appointment.startMin >= savedLunch.endMin));
check("32. moved date becomes occurrence override", savedLunch && savedLunch.isOverride === true);
check("33. next recurrence remains at preferred time", savedOcc.find(function (row) {
  return row.dateKey === "2026-09-22";
}).startMin === 14 * 60);
const reloaded = series.generateOccurrences([lunchSeries()], WEEK, Object.keys(exceptions).map(function (key) {
  return exceptions[key];
}));
check("34. reload preserves the moved occurrence", reloaded.find(function (row) {
  return row.dateKey === "2026-09-21";
}).startMin === savedLunch.startMin);

const card = blocks.blockHtml(occ("2026-09-21"), layout.windowToRect(14 * 60, 14 * 60 + 30, 8 * 60, 19 * 60));
check("35. recurring card shows reason/time/note", card.indexOf("Lunch Break") !== -1
  && card.indexOf("2:00 PM") !== -1 && card.indexOf("2:30 PM") !== -1);
const movedCard = blocks.blockHtml(wedMoved, layout.windowToRect(13 * 60 + 30, 14 * 60, 8 * 60, 19 * 60));
check("36. moved occurrence displays actual new time", movedCard.indexOf("1:30 PM") !== -1
  && movedCard.indexOf("Moved from 2:00 PM") !== -1);

const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");
check("37. manual drag still works", dragSrc.indexOf("function assignBlock") !== -1
  && dragSrc.indexOf('kind: "block"') !== -1);
check("38. cross-provider confirmation still works", dragSrc.indexOf("confirmBlockProviderMove") !== -1
  && dragSrc.indexOf("isBlockProviderChange") !== -1);

const htmlSrc = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const rulesSrc = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const dataSrc = fs.readFileSync(path.join(root, "public/booking/blocks/data.js"), "utf8");
const apptSrc = fs.readFileSync(path.join(root, "public/booking/appointments/data.js"), "utf8");
check("editor UI has Repeat and Flexibility", recUi && typeof recUi.fieldsHtml === "function"
  && recUi.fieldsHtml(oneOff, function () { return ""; }).indexOf("Does not repeat") !== -1
  && recUi.fieldsHtml(oneOff, function () { return ""; }).indexOf("Flexible") !== -1);
check("custom days and repeat ends are in the editor", recUi.fieldsHtml(Object.assign({}, oneOff, { repeatFrequency: "custom" }), function () { return ""; }).indexOf("Mon") !== -1
  && recUi.fieldsHtml(oneOff, function () { return ""; }).indexOf("Repeat starts") !== -1
  && recUi.fieldsHtml(oneOff, function () { return ""; }).indexOf("Never") !== -1);
check("occurrence editor supports this occurrence scope", recUi.fieldsHtml(occ("2026-09-23"), function () { return ""; }).indexOf("This occurrence") !== -1
  && recUi.fieldsHtml(occ("2026-09-23"), function () { return ""; }).indexOf("Entire series") !== -1);
check("series is not exploded into future documents", dataSrc.indexOf("generateOccurrences") !== -1
  && dataSrc.indexOf("calendarBlockSeries") !== -1
  && dataSrc.indexOf("calendarBlockExceptions") !== -1);
check("booking save applies occurrence override", apptSrc.indexOf("applyRelocations") !== -1
  && dataSrc.indexOf("overrideOccurrence") !== -1);
check("modules are wired in index.html", htmlSrc.indexOf("/booking/blocks/series-model.js") !== -1
  && htmlSrc.indexOf("/booking/blocks/flex-relocate.js") !== -1
  && htmlSrc.indexOf("/booking/blocks/editor-recurrence.js") !== -1);
check("rules add series and exception collections", rulesSrc.indexOf("calendarBlockSeries") !== -1
  && rulesSrc.indexOf("calendarBlockExceptions") !== -1);
check("existing calendarBlocks match remains", rulesSrc.indexOf("match /salons/{salonId}/calendarBlocks/{blockId}") !== -1);
check("legacy one-off still normalizes without recurrence fields", model.normalize({
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-01-05",
  startMin: 12 * 60,
  endMin: 13 * 60,
  reason: "meeting"
}).flexibilityMode === "fixed");

const opened = editor.openCreate({
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-09-21",
  startMin: 14 * 60,
  durationMinutes: 30
});
check("create editor still defaults to one-off Fixed", opened && opened.repeatFrequency === "none"
  && opened.flexibilityMode === "fixed");
editor.close();

blocks.setAll(weekdaysOcc);
check("idempotent cache ids", blocks.forView("2026-09-22", "loc1").length === 1
  && blocks.forView("2026-09-22", "loc1")[0].blockId === series.occurrenceId("serLunch", "2026-09-22"));

const rejectedFixed = engine.canProviderFitDuration("rebecca", { dateKey: "2026-09-21", minutes: 14 * 60 }, 60, "loc1");
blocks.setAll([fixed]);
check("availability still hard-blocks Fixed without relocate success", engine.canProviderFitDuration(
  "rebecca",
  { dateKey: "2026-09-21", minutes: 14 * 60 },
  60,
  "loc1"
) === false);

blocks.setAll([flexible]);
check("availability allows Flexible when a replacement exists", engine.canProviderFitDuration(
  "rebecca",
  { dateKey: "2026-09-21", minutes: 14 * 60 },
  60,
  "loc1"
) === true);
const calData = windowObj.ffBookingCalData;
const dayAxis = calData.axisFromDay(calData.businessDayFor("2026-09-21", "loc1"));
const dropEmp = { id: "rebecca", working: [{ startMin: 9 * 60, endMin: 18 * 60 }] };
blocks.setAll([flexible]);
check("drop inspect allows Flexible preferred slot when it can move", drop.inspect({
  providerId: "rebecca",
  startMin: 14 * 60,
  durationMinutes: 60,
  dateKey: "2026-09-21",
  locationId: "loc1",
  axis: dayAxis,
  employee: dropEmp
}).ok === true);
blocks.setAll([fixed]);
check("drop inspect still rejects Fixed", drop.inspect({
  providerId: "rebecca",
  startMin: 14 * 60,
  durationMinutes: 60,
  dateKey: "2026-09-21",
  locationId: "loc1",
  axis: dayAxis,
  employee: dropEmp
}).reason === "provider_blocked");

if (failed) {
  console.error(failed + " recurring flexible Time Block tests failed.");
  process.exit(1);
}
console.log("All recurring flexible Time Block tests passed.");
