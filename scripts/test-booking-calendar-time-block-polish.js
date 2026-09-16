/**
 * Time Block Calendar polish — card copy, note/reason, duration, provider-move confirm.
 * Usage: node scripts/test-booking-calendar-time-block-polish.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const docListeners = {};
const createdNodes = [];
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
  dispatchEvent: function (ev) {
    (docListeners[ev && ev.type] || []).forEach(function (fn) { fn(ev); });
    return true;
  },
  getElementById: function (id) {
    return createdNodes.find(function (el) { return el.id === id; }) || null;
  },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) {
    var el = {
      tagName: String(tag || "").toUpperCase(),
      id: "",
      className: "",
      hidden: false,
      innerHTML: "",
      style: {},
      classList: { add: function () {}, remove: function () {}, toggle: function () {} },
      setAttribute: function (name, value) {
        if (name === "id") el.id = value;
        if (name === "class") el.className = value;
      },
      removeAttribute: function () {},
      querySelector: function (sel) {
        if (sel === ".ff-cal-move-acts") return el._acts || null;
        if (sel === '[data-ff-cal-move="yes"]') return el._go || null;
        return null;
      },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      focus: function () {}
    };
    return el;
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
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-state.js", windowObj);
load("public/booking/availability.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/blocks/model.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-drag.js", windowObj);
load("public/booking/blocks/editor.js", windowObj);
load("public/booking/blocks/ui.js", windowObj);

const model = windowObj.ffBookingBlockModel;
const blocks = windowObj.ffBookingCalBlocks;
const editor = windowObj.ffBookingBlockEditor;
const drag = windowObj.ffBookingCalDrag;
const ui = windowObj.ffBookingCalBlockUi;

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
windowObj.ffBookingBlocks = {
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
  }
};

const editorSrc = fs.readFileSync(path.join(root, "public/booking/blocks/editor.js"), "utf8");
const uiSrc = fs.readFileSync(path.join(root, "public/booking/blocks/ui.js"), "utf8");
const menuSrc = fs.readFileSync(path.join(root, "public/booking/calendar-menu.js"), "utf8");
const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");
const paintSrc = fs.readFileSync(path.join(root, "public/booking/calendar-blocks.js"), "utf8");
const modelSrc = fs.readFileSync(path.join(root, "public/booking/blocks/model.js"), "utf8");
const dataSrc = fs.readFileSync(path.join(root, "public/booking/blocks/data.js"), "utf8");
const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
const cardCss = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-cards.css"), "utf8");

check("UI terminology uses Time Block in the editor title", editorSrc.indexOf("<h2>Time Block</h2>") !== -1);
check("UI terminology uses Time Block in the slot chooser", uiSrc.indexOf(">Time Block<") !== -1 && uiSrc.indexOf(">Block Time<") === -1);
check("UI terminology uses Time Block in the provider menu", menuSrc.indexOf('label: "Time Block"') !== -1);
check("UI terminology no longer uses Edit Block Time", editorSrc.indexOf("Edit Block Time") === -1 && editorSrc.indexOf("Block Time") === -1);
check("persisted collection name is unchanged", dataSrc.indexOf("calendarBlocks") !== -1 && modelSrc.indexOf("calendarBlocks") !== -1);

check("existing reasons stay lunch/break/meeting/training/personal/other",
  model.REASONS.join(",") === "lunch,break,meeting,training,personal,other");
check("Lunch Break is a display label, not a new persisted reason",
  model.labelForReason("lunch") === "Lunch Break" && model.normalizeReason("Lunch Break") === "lunch");
check("legacy lunch label is not treated as a custom note", model.displayNote({
  reason: "lunch",
  label: "Lunch",
  note: ""
}) === "");

const legacy = model.normalize({
  blockId: "blk_legacy",
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-09-16",
  startMin: 11 * 60,
  endMin: 11 * 60 + 30,
  reason: "other",
  label: "Inventory delivery"
});
check("existing Time Block loads", !!(legacy && legacy.blockId === "blk_legacy" && legacy.reason === "other"));
check("legacy label without note becomes the display note", legacy.note === "Inventory delivery");

return windowObj.ffBookingBlocks.create({
  providerId: "rebecca",
  locationId: "loc1",
  dateKey: "2026-09-16",
  startMin: 13 * 60 + 30,
  endMin: 14 * 60,
  reason: "meeting",
  note: "Staff meeting"
}).then(function (created) {
  check("new Time Block saves reason", created.reason === "meeting");
  check("new Time Block saves note", created.note === "Staff meeting");

  const meetingCard = blocks.blockHtml(created, { top: 10, height: 48 });
  check("Calendar card renders reason", meetingCard.indexOf("Meeting") !== -1 && meetingCard.indexOf('data-ff-cal-block-reason="meeting"') !== -1);
  check("Calendar card renders actual start/end time", meetingCard.indexOf("1:30 PM – 2:00 PM") !== -1 && meetingCard.indexOf('data-ff-cal-start="810"') !== -1);
  check("Calendar card renders note when present", meetingCard.indexOf("Staff meeting") !== -1 && meetingCard.indexOf("ff-cal-block-note") !== -1);
  check("Calendar card is still not an appointment card", meetingCard.indexOf("ff-cal-card") === -1);

  const lunch = model.normalize({
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16",
    startMin: 12 * 60,
    endMin: 12 * 60 + 45,
    reason: "lunch"
  });
  const lunchCard = blocks.blockHtml(lunch, { top: 20, height: 40 });
  check("Lunch Break renders correctly", lunchCard.indexOf("Lunch Break") !== -1 && lunchCard.indexOf("12:00 PM – 12:45 PM") !== -1);
  check("Calendar card hides note line when absent", lunchCard.indexOf("ff-cal-block-note") === -1 && lunchCard.indexOf("data-ff-cal-block-note") === -1);

  const other = model.normalize({
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16",
    startMin: 11 * 60,
    endMin: 11 * 60 + 30,
    reason: "other",
    note: "Inventory delivery"
  });
  const otherCard = blocks.blockHtml(other, { top: 8, height: 36 });
  check("Other + custom detail renders correctly",
    otherCard.indexOf("Other") !== -1 &&
    otherCard.indexOf("11:00 AM – 11:30 AM") !== -1 &&
    otherCard.indexOf("Inventory delivery") !== -1);

  const personal = model.normalize({
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16",
    startMin: 15 * 60,
    endMin: 16 * 60,
    reason: "personal",
    note: "Doctor appointment"
  });
  check("Personal + note renders correctly",
    blocks.blockHtml(personal, { top: 4, height: 48 }).indexOf("Personal") !== -1 &&
    blocks.blockHtml(personal, { top: 4, height: 48 }).indexOf("Doctor appointment") !== -1 &&
    blocks.blockHtml(personal, { top: 4, height: 48 }).indexOf("3:00 PM – 4:00 PM") !== -1);

  const training = model.normalize({
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16",
    startMin: 10 * 60,
    endMin: 11 * 60 + 30,
    reason: "training",
    note: "Russian manicure training"
  });
  check("Training + note renders correctly",
    blocks.cardLines(training).reason === "Training" &&
    blocks.cardLines(training).note === "Russian manicure training" &&
    blocks.cardLines(training).time === "10:00 AM – 11:30 AM");

  const longNote = model.normalize({
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16",
    startMin: 9 * 60,
    endMin: 9 * 60 + 15,
    reason: "personal",
    note: "A very long Time Block note that must stay available in the editor even if the card truncates it visually"
  });
  const longCard = blocks.blockHtml(longNote, { top: 0, height: 18 });
  check("long notes stay in the card title and full text",
    longCard.indexOf("text-overflow") === -1 &&
    longCard.indexOf(longNote.note) !== -1);

  const opened = editor.openEdit(created);
  check("reopen preserves reason/note/time", !!(
    opened &&
    opened.reason === "meeting" &&
    opened.note === "Staff meeting" &&
    opened.startMin === 13 * 60 + 30 &&
    opened.endMin === 14 * 60
  ));
  const saveNoChange = editor.specFromState(editor.current());
  check("save-without-change preserves duration",
    saveNoChange.endMin - saveNoChange.startMin === 30 &&
    saveNoChange.startMin === created.startMin &&
    saveNoChange.endMin === created.endMin);

  const reasonOnly = editor.specFromState(Object.assign({}, created, { reason: "training" }));
  check("reason-only edit preserves duration",
    reasonOnly.reason === "training" &&
    reasonOnly.startMin === created.startMin &&
    reasonOnly.endMin === created.endMin);

  const noteOnly = editor.specFromState(Object.assign({}, created, { note: "Manager meeting" }));
  check("note-only edit preserves duration",
    noteOnly.note === "Manager meeting" &&
    noteOnly.reason === "meeting" &&
    noteOnly.endMin === created.endMin);

  const sameProvider = drag.blockMoveSpec({
    source: {
      kind: "block",
      blockId: created.blockId,
      fromProviderId: "rebecca",
      fromLocationId: "loc1",
      fromDateKey: "2026-09-16",
      durationMinutes: 30,
      reason: created.reason,
      note: created.note,
      label: created.label
    },
    providerId: "rebecca",
    startMin: 16 * 60,
    dateKey: "2026-09-16"
  });
  check("same-provider drag preserves all Time Block metadata", !!(
    sameProvider &&
    sameProvider.providerId === "rebecca" &&
    sameProvider.reason === "meeting" &&
    sameProvider.note === "Staff meeting" &&
    sameProvider.endMin - sameProvider.startMin === 30 &&
    sameProvider.startMin === 16 * 60
  ));

  const cross = {
    source: {
      kind: "block",
      blockId: created.blockId,
      fromProviderId: "rebecca",
      fromLocationId: "loc1",
      fromDateKey: "2026-09-16",
      durationMinutes: 30,
      reason: created.reason,
      note: created.note,
      label: created.label
    },
    providerId: "nicole",
    startMin: 13 * 60 + 30,
    dateKey: "2026-09-16"
  };
  check("cross-provider drag asks for confirmation", drag.isBlockProviderChange(cross) === true);
  check("canceling a provider-move does not persist", drag.moveAskResult("no").ok === false);
  check("appointment Calendar behavior remains unchanged",
    drag.isProviderChange({
      source: { kind: "card", appointmentId: "a1", fromProviderId: "rebecca" },
      providerId: "nicole"
    }) === true &&
    drag.isProviderChange(cross) === false &&
    calSrc.indexOf("openAppointmentFromHit") !== -1 &&
    cardCss.indexOf(".ff-cal-card") !== -1 &&
    paintSrc.indexOf("ff-cal-card") === -1
  );
  check("cross-provider Time Block drop confirms before persist",
    /source\.kind === "block"[\s\S]*confirmBlockProviderMove[\s\S]*assignBlock/.test(dragSrc) &&
    dragSrc.indexOf("Move Time Block?") !== -1 &&
    dragSrc.indexOf("window.confirm") === -1
  );

  const beforeCancel = model.normalize(created);
  check("cancel provider-move leaves original block unchanged",
    persisted[0].providerId === "rebecca" &&
    persisted[0].reason === beforeCancel.reason &&
    persisted[0].note === beforeCancel.note &&
    persisted[0].startMin === beforeCancel.startMin &&
    persisted[0].endMin === beforeCancel.endMin
  );

  return windowObj.ffBookingBlocks.update(created.blockId, drag.blockMoveSpec(cross)).then(function (movedRow) {
    check("confirm provider-move changes provider only and preserves reason/note/duration", !!(
      movedRow &&
      movedRow.providerId === "nicole" &&
      movedRow.reason === "meeting" &&
      movedRow.note === "Staff meeting" &&
      movedRow.startMin === 13 * 60 + 30 &&
      movedRow.endMin === 14 * 60
    ));

    const noNoteLegacy = model.normalize({
      providerId: "rebecca",
      locationId: "loc1",
      dateKey: "2026-09-16",
      startMin: 8 * 60,
      endMin: 8 * 60 + 15,
      reason: "break"
    });
    check("historical blocks with no note still render safely",
      blocks.cardLines(noNoteLegacy).note === "" &&
      blocks.blockHtml(noNoteLegacy, { top: 0, height: 18 }).indexOf("Break") !== -1);

    check("chooser still offers New Appointment first",
      uiSrc.indexOf("New Appointment") !== -1 &&
      uiSrc.indexOf('data-ff-cal-slot="appointment"') !== -1);
    check("Time Block click still opens the existing editor",
      typeof ui.openEdit === "function" &&
      typeof editor.openEdit === "function");

    if (failed) {
      console.error(failed + " Time Block polish tests failed.");
      process.exit(1);
    }
    console.log("All Time Block polish tests passed.");
  });
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
