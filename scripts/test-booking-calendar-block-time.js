/**
 * Persistent Calendar Block Time — create, edit, delete, bookability.
 * Usage: node scripts/test-booking-calendar-block-time.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const docListeners = {};
const documentMock = {
  readyState: "complete",
  documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} },
  body: {
    classList: { add: function () {}, remove: function () {} },
    appendChild: function () {}
  },
  addEventListener: function (type, fn) {
    (docListeners[type] || (docListeners[type] = [])).push(fn);
  },
  dispatchEvent: function (ev) {
    (docListeners[ev && ev.type] || []).forEach(function (fn) { fn(ev); });
    return true;
  },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () {
    return {
      style: {},
      setAttribute: function () {},
      removeAttribute: function () {},
      querySelector: function () { return null; },
      classList: { add: function () {}, remove: function () {} }
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
    return {
      staff: [{
        id: "ashley",
        name: "Ashley Rivera",
        technicianTypes: ["nails"],
        defaultSchedule: {
          monday: { enabled: true, startTime: "10:00", endTime: "18:00" }
        }
      }]
    };
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-state.js", windowObj);
load("public/booking/availability.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/blocks/model.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-week.js", windowObj);
load("public/booking/calendar.js", windowObj);
load("public/booking/blocks/editor.js", windowObj);
load("public/booking/blocks/ui.js", windowObj);

const model = windowObj.ffBookingBlockModel;
const blocks = windowObj.ffBookingCalBlocks;
const drop = windowObj.ffBookingCalDrop;
const av = windowObj.ffBookingCalAvailability;
const data = windowObj.ffBookingCalData;
const editor = windowObj.ffBookingBlockEditor;
const ui = windowObj.ffBookingCalBlockUi;
const st = windowObj.ffBookingCalState;
const week = windowObj.ffBookingCalWeek;
const engine = windowObj.ffBookingAvailability;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const persisted = [];
let nextId = 1;
function persistAll() {
  return persisted.map(function (row) { return Object.assign({}, row); });
}
function applyLoaded(rows) {
  blocks.setAll(rows);
  return rows;
}
windowObj.ffBookingBlocks = {
  loadForView: function (dateKey, locationId) {
    const rows = persistAll().filter(function (row) {
      return row.dateKey === dateKey && row.locationId === locationId;
    });
    return Promise.resolve(applyLoaded(rows));
  },
  loadForDates: function (dateKeys, locationId) {
    const keys = dateKeys || [];
    const rows = persistAll().filter(function (row) {
      return row.locationId === locationId && keys.indexOf(row.dateKey) !== -1;
    });
    return Promise.resolve(applyLoaded(rows));
  },
  create: function (spec) {
    const row = model.normalize(Object.assign({ blockId: "blk_" + nextId }, spec));
    nextId += 1;
    persisted.push(row);
    blocks.upsert(row);
    return Promise.resolve(row);
  },
  update: function (blockId, spec) {
    const row = model.normalize(Object.assign({ blockId: blockId }, spec));
    const idx = persisted.findIndex(function (item) { return item.blockId === blockId; });
    if (idx !== -1) persisted[idx] = row;
    blocks.upsert(row);
    return Promise.resolve(row);
  },
  remove: function (blockId) {
    const idx = persisted.findIndex(function (item) { return item.blockId === blockId; });
    if (idx !== -1) persisted.splice(idx, 1);
    blocks.remove(blockId);
    return Promise.resolve(blockId);
  }
};

const cards = [];
windowObj.ffBookingCalAppointments = {
  cardsForProvider: function (dateKey, locationId, providerId) {
    return cards.filter(function (card) {
      return card.dateKey === dateKey && card.locationId === locationId && card.providerId === providerId;
    });
  }
};

st.setLocationId("loc1");
st.setSelectedDateKey("2026-09-14");
st.setEmployees([{
  id: "ashley",
  firstName: "Ashley",
  displayName: "Ashley Rivera",
  name: "Ashley Rivera",
  working: [{ startMin: 10 * 60, endMin: 18 * 60 }]
}]);
st.setView("day");

const dayHit = {
  slot: { providerId: "ashley", dateKey: "2026-09-14", startMin: 13 * 60 },
  locationId: "loc1",
  employees: st.getEmployees(),
  axis: data.axisFromDay(data.businessDayFor("2026-09-14", "loc1"))
};

const daySpec = ui.hitToCreateSpec(dayHit);
check("Day create prefill uses clicked provider", daySpec.providerId === "ashley");
check("Day create prefill uses active location", daySpec.locationId === "loc1");
check("Day create prefill uses clicked date", daySpec.dateKey === "2026-09-14");
check("Day create prefill uses clicked start", daySpec.startMin === 13 * 60);

return windowObj.ffBookingBlocks.create(Object.assign({}, daySpec, {
  reason: "lunch",
  durationMinutes: 30
})).then(function (created) {
  check("create Day Block Time persists lunch", !!(created && created.blockId && created.reason === "lunch"));
  check("created start/end are 1:00–1:30", created.startMin === 13 * 60 && created.endMin === 13 * 60 + 30);
  check("selected reason persists", created.reason === "lunch" && created.label === "Lunch");

  st.setView("week");
  st.setWeekProviderId("ashley");
  st.setWeekAnchorKey("2026-09-14");
  const weekHit = week.createHit("2026-09-15", 11 * 60);
  const weekSpec = ui.hitToCreateSpec(weekHit);
  check("Week create uses current Week provider", weekSpec.providerId === "ashley");
  check("Week create uses clicked day", weekSpec.dateKey === "2026-09-15");
  check("Week create uses clicked time", weekSpec.startMin === 11 * 60);
  check("Week create uses active location", weekSpec.locationId === "loc1");

  return windowObj.ffBookingBlocks.create(Object.assign({}, weekSpec, {
    reason: "meeting",
    durationMinutes: 45
  }));
}).then(function (weekCreated) {
  check("create Week Block Time persists meeting", weekCreated.reason === "meeting" && weekCreated.endMin === 11 * 60 + 45);

  blocks.clear();
  check("cache can be emptied before reload", blocks.getAll().length === 0);
  return windowObj.ffBookingBlocks.loadForView("2026-09-14", "loc1");
}).then(function (dayRows) {
  check("block reloads from persisted source", dayRows.length === 1 && dayRows[0].reason === "lunch");
  check("reload keeps correct provider only", dayRows.every(function (row) { return row.providerId === "ashley"; }));
  check("reload keeps correct location only", dayRows.every(function (row) { return row.locationId === "loc1"; }));
  check("reload keeps correct date only", dayRows.every(function (row) { return row.dateKey === "2026-09-14"; }));

  return windowObj.ffBookingBlocks.loadForDates([
    "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"
  ], "loc1");
}).then(function (weekRows) {
  check("Week load returns both persisted blocks", weekRows.length === 2);
  check("refresh/load path does not duplicate blocks", weekRows.length === persisted.length && blocks.getAll().length === 2);

  return windowObj.ffBookingBlocks.loadForView("2026-09-14", "loc2");
}).then(function (otherLoc) {
  check("other location does not receive loc1 blocks", otherLoc.length === 0);
  return windowObj.ffBookingBlocks.loadForView("2026-09-16", "loc1");
}).then(function (otherDay) {
  check("other date does not receive Sep 14/15 blocks", otherDay.length === 0);
  return windowObj.ffBookingBlocks.loadForDates(["2026-09-14", "2026-09-15"], "loc1");
}).then(function () {
  const emp = { id: "ashley", working: [{ startMin: 10 * 60, endMin: 18 * 60 }] };
  const axis = data.axisFromDay(data.businessDayFor("2026-09-14", "loc1"));
  axis.dateKey = "2026-09-14";
  axis.locationId = "loc1";
  check("reasonAt on persisted lunch is provider_blocked", av.reasonAt(emp, axis, 13 * 60) === "provider_blocked");
  check("create appointment overlapping block rejected", drop.inspectCreate({
    providerId: "ashley",
    startMin: 13 * 60,
    durationMinutes: 30,
    axis: axis,
    employee: emp
  }).reason === "provider_blocked");
  check("Day drag into block rejected", drop.inspect({
    providerId: "ashley",
    startMin: 13 * 60 + 15,
    durationMinutes: 30,
    axis: axis,
    employee: emp
  }).reason === "provider_blocked");

  st.setView("week");
  st.setWeekProviderId("ashley");
  st.setWeekAnchorKey("2026-09-14");
  const weekBlocked = week.inspectCreate("2026-09-14", 13 * 60);
  check("Week drag/create into block rejected", weekBlocked.ok === false && weekBlocked.reason === "provider_blocked");
  check("adjacent non-overlap remains valid", drop.inspectCreate({
    providerId: "ashley",
    startMin: 12 * 60 + 30,
    durationMinutes: 30,
    axis: axis,
    employee: emp
  }).ok === true);
  check("engine still uses the same block cache", engine.canProviderFitDuration("ashley", {
    dateKey: "2026-09-14",
    minutes: 13 * 60
  }, 30, "loc1") === false);

  cards.push({
    appointmentId: "apt1",
    providerId: "ashley",
    locationId: "loc1",
    dateKey: "2026-09-14",
    startMin: 15 * 60,
    endMin: 16 * 60
  });
  const overAppt = editor.inspectSave(model.normalize({
    providerId: "ashley",
    locationId: "loc1",
    dateKey: "2026-09-14",
    startMin: 15 * 60,
    endMin: 15 * 60 + 30,
    reason: "break"
  }));
  check("cannot create block over existing appointment", overAppt.ok === false && overAppt.reason === "appointment_conflict");

  const lunch = blocks.forProvider("2026-09-14", "loc1", "ashley")[0];
  return windowObj.ffBookingBlocks.update(lunch.blockId, Object.assign({}, lunch, {
    reason: "training",
    startMin: 14 * 60,
    endMin: 15 * 60
  }));
}).then(function (updated) {
  check("edit reason persists", updated.reason === "training" && updated.label === "Training");
  check("edit time persists", updated.startMin === 14 * 60 && updated.endMin === 15 * 60);
  const painted = blocks.forProvider("2026-09-14", "loc1", "ashley")[0];
  check("updated block rerenders from cache", painted.reason === "training" && painted.startMin === 14 * 60);

  const emp = { id: "ashley", working: [{ startMin: 10 * 60, endMin: 18 * 60 }] };
  const axis = data.axisFromDay(data.businessDayFor("2026-09-14", "loc1"));
  axis.dateKey = "2026-09-14";
  axis.locationId = "loc1";
  check("changed time affects bookability — old lunch slot is free", drop.inspectCreate({
    providerId: "ashley",
    startMin: 13 * 60,
    durationMinutes: 30,
    axis: axis,
    employee: emp
  }).ok === true);
  check("changed time affects bookability — new training slot is blocked", drop.inspectCreate({
    providerId: "ashley",
    startMin: 14 * 60,
    durationMinutes: 30,
    axis: axis,
    employee: emp
  }).reason === "provider_blocked");

  const id = updated.blockId;
  return windowObj.ffBookingBlocks.remove(id).then(function () {
    return { id: id, emp: emp, axis: axis };
  });
}).then(function (ctx) {
  check("delete removes block from cache", blocks.getById(ctx.id) === null);
  check("delete removes block from persist store", persisted.every(function (row) { return row.blockId !== ctx.id; }));
  check("slot becomes available again if otherwise bookable", drop.inspectCreate({
    providerId: "ashley",
    startMin: 14 * 60,
    durationMinutes: 30,
    axis: ctx.axis,
    employee: ctx.emp
  }).ok === true);

  st.setView("day");
  check("Day/Week switch preserves remaining block", blocks.forProvider("2026-09-15", "loc1", "ashley").length === 1);
  st.setView("week");
  check("Week view still has the meeting block", blocks.forProvider("2026-09-15", "loc1", "ashley")[0].reason === "meeting");

  const meeting = blocks.forProvider("2026-09-15", "loc1", "ashley")[0];
  st.setVisibleProviderIds(["nicole"]);
  check("provider filter hides another provider's block from that column", blocks.forProvider("2026-09-15", "loc1", "nicole").length === 0);
  st.setVisibleProviderIds(["ashley"]);
  check("provider filter restores Ashley block data", blocks.forProvider("2026-09-15", "loc1", "ashley")[0].blockId === meeting.blockId);

  const markup = blocks.blockHtml(meeting, { top: 10, height: 40 });
  check("persisted block remains printable Day/Week", markup.indexOf("ff-cal-block") !== -1 && markup.indexOf("Meeting") !== -1);
  check("block markup is still not an appointment card", markup.indexOf("ff-cal-card") === -1);

  check("unavailable aliases to other", model.normalizeReason("unavailable") === "other");
  check("model rejects client/service fields as identity", !model.normalize({
    providerId: "ashley",
    locationId: "loc1",
    dateKey: "bad",
    startMin: 10,
    endMin: 20
  }));

  const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
  const htmlSrc = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
  const rulesSrc = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  check("Day/Week empty slot opens the shared chooser", calSrc.indexOf("offerSlotCreate") !== -1 && calSrc.indexOf("openChooser") !== -1);
  check("block click opens the editor", calSrc.indexOf("openBlockFromEl") !== -1);
  check("Calendar reloads persisted blocks", calSrc.indexOf("syncBlocks") !== -1 && calSrc.indexOf("ffBookingBlocks") !== -1);
  check("modules are wired in index.html", htmlSrc.indexOf("/booking/blocks/model.js") !== -1 && htmlSrc.indexOf("/booking/blocks/data.js") !== -1 && htmlSrc.indexOf("/booking/blocks/editor.js") !== -1);
  check("block chips are clickable", /\.ff-cal-block\s*\{[^}]*pointer-events:\s*auto/.test(cssSrc));
  check("rules add an isolated calendarBlocks match", rulesSrc.indexOf("match /salons/{salonId}/calendarBlocks/{blockId}") !== -1);
  check("rules keep blocks inside salon membership", rulesSrc.indexOf("allow delete: if belongsToSalon(salonId);") !== -1);
  check("appointment delete stays manager-only", /match \/salons\/\{salonId\}\/appointments\/\{appointmentId\}[\s\S]*?allow delete: if belongsToSalon\(salonId\) && isManager\(salonId\);/.test(rulesSrc));

  if (failed) {
    console.error(failed + " calendar block-time tests failed.");
    process.exit(1);
  }
  console.log("All calendar block-time tests passed.");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
