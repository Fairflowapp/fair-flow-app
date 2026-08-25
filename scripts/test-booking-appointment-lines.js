/**
 * Multi-service appointment form helpers. No Firestore writes.
 * Usage: node scripts/test-booking-appointment-lines.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/form.js", windowObj);
load("public/booking/calendar-draft.js", windowObj);

const form = windowObj.ffBookingAppointmentForm;
const model = windowObj.ffBookingAppointmentModel;
const draft = windowObj.ffBookingCalDraft;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

windowObj.ffBookingAppointmentServices = {
  listForProvider: async function (providerId) {
    if (providerId === "koko") {
      return [{ id: "mani", name: "Manicure", durationMinutes: 60, price: 55, raw: { durationMinutes: 60, defaultPrice: 55 } }];
    }
    return [{ id: "pedi", name: "Pedicure", durationMinutes: 60, price: 65, raw: { durationMinutes: 60, defaultPrice: 65 } }];
  },
  effectiveDuration: function (service) { return Number(service.durationMinutes) || 60; },
  effectivePrice: function (service) { return Number(service.defaultPrice || service.price) || 0; }
};

const state = form.emptyState({
  locationId: "locA",
  dateKey: "2026-08-24",
  startMin: 11 * 60 + 45,
  providerId: "koko"
});
check("A starts with one line", state.lines.length === 1);
check("seeded start stays on line 1", state.lines[0].startMin === 11 * 60 + 45);

form.setLineService(state, state.lines[0].key, "mani");
state.lines[0].services = [{ id: "mani", name: "Manicure", durationMinutes: 60, price: 55, raw: { durationMinutes: 60, defaultPrice: 55 } }];
form.setLineService(state, state.lines[0].key, "mani");
check("P line 1 keeps its own price", state.lines[0].price === 55);
check("P line 1 keeps its own duration", state.lines[0].durationMinutes === 60);
check("line 1 end is 12:45", state.lines[0].endMin === 12 * 60 + 45);

form.addLine(state);
check("I add a second line", state.lines.length === 2);
check("C default start is previous end", state.lines[1].startMin === 12 * 60 + 45);
check("line 2 provider starts empty", state.lines[1].providerId === "");

state.lines[1].providerId = "bobo";
state.lines[1].services = [{ id: "pedi", name: "Pedicure", durationMinutes: 60, price: 65, raw: { durationMinutes: 60, defaultPrice: 65 } }];
form.setLineService(state, state.lines[1].key, "pedi");
check("D line 2 provider is independent", state.lines[0].providerId === "koko" && state.lines[1].providerId === "bobo");
check("O line 2 keeps its own price", state.lines[1].price === 65);
check("changing line 2 start does not move line 1", (function () {
  const first = state.lines[0].startMin;
  form.setLineStart(state, state.lines[1].key, 12 * 60);
  return state.lines[0].startMin === first && state.lines[1].startMin === 12 * 60;
})());

form.setLineStart(state, state.lines[1].key, 12 * 60 + 45);
form.addLine(state);
check("I add a third service", state.lines.length === 3);
form.removeLine(state, state.lines[2].key);
check("J remove third service", state.lines.length === 2);
form.removeLine(state, state.lines[1].key);
check("J remove second service", state.lines.length === 1);
const lastKey = state.lines[0].key;
form.removeLine(state, lastKey);
check("K cannot remove the last service", state.lines.length === 1 && state.lines[0].key === lastKey);

form.addLine(state);
state.lines[1].providerId = "bobo";
state.lines[1].services = [{ id: "pedi", name: "Pedicure", durationMinutes: 60, price: 65, raw: { durationMinutes: 60, defaultPrice: 65 } }];
form.setLineService(state, state.lines[1].key, "pedi");
form.setClient(state, { clientId: "cli_1", displayName: "Shiri A" });
check("C same client on the appointment", state.clientId === "cli_1");
check("A one complete line can create after restore", (function () {
  const one = form.emptyState({ locationId: "locA", dateKey: "2026-08-24", startMin: 705, providerId: "koko" });
  one.lines[0].services = [{ id: "mani", name: "Manicure", durationMinutes: 60, price: 55, raw: { durationMinutes: 60, defaultPrice: 55 } }];
  form.setLineService(one, one.lines[0].key, "mani");
  form.setClient(one, { clientId: "cli_1", displayName: "Shiri A" });
  return form.canCreate(one) === true && one.lines.length === 1;
})());
check("B two complete lines can create", form.canCreate(state) === true && state.lines.length === 2);

const hold = form.holdSpec(state);
check("Q hold has one block per line", hold && hold.lines.length === 2);
check("R hold uses each provider", hold.lines[0].providerId === "koko" && hold.lines[1].providerId === "bobo");
check("S hold uses each start", hold.lines[0].startMin === 11 * 60 + 45 && hold.lines[1].startMin === 12 * 60 + 45);

draft.set(hold);
const snap = draft.get();
check("draft stores all hold lines", snap && snap.lines && snap.lines.length === 2);
check("draft first-line compat still works", snap.providerId === "koko");

const windowTimes = model.deriveWindow([
  { startAt: new Date("2026-08-24T15:45:00.000Z"), endAt: new Date("2026-08-24T16:45:00.000Z") },
  { startAt: new Date("2026-08-24T16:15:00.000Z"), endAt: new Date("2026-08-24T17:15:00.000Z") }
]);
check("M startAt is earliest line", windowTimes.startAt.getTime() === Date.parse("2026-08-24T15:45:00.000Z"));
check("N endAt is latest line", windowTimes.endAt.getTime() === Date.parse("2026-08-24T17:15:00.000Z"));

const providerIds = [...new Set(["koko", "bobo", "koko"])];
check("L providerIds are unique", providerIds.join(",") === "koko,bobo");

check("F different providers may overlap", model.intervalsOverlap(
  new Date("2026-08-24T15:45:00.000Z"),
  new Date("2026-08-24T16:45:00.000Z"),
  new Date("2026-08-24T16:00:00.000Z"),
  new Date("2026-08-24T17:00:00.000Z")
) === true);
check("G same-provider overlap is overlap", model.intervalsOverlap(
  new Date("2026-08-24T15:00:00.000Z"),
  new Date("2026-08-24T16:00:00.000Z"),
  new Date("2026-08-24T15:30:00.000Z"),
  new Date("2026-08-24T16:30:00.000Z")
) === true);
check("E sequential same-provider is allowed", model.intervalsOverlap(
  new Date("2026-08-24T15:45:00.000Z"),
  new Date("2026-08-24T16:45:00.000Z"),
  new Date("2026-08-24T16:45:00.000Z"),
  new Date("2026-08-24T17:45:00.000Z")
) === false);

const edit = form.editStateFrom({
  appointmentId: "appt_1",
  clientId: "cli_1",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "",
  lines: [
    { lineId: "line_1", providerId: "koko", serviceId: "mani", serviceName: "Manicure", startMin: 11 * 60 + 45, durationMinutes: 60, price: 55 },
    { lineId: "line_2", providerId: "bobo", serviceId: "pedi", serviceName: "Pedicure", startMin: 12 * 60 + 45, durationMinutes: 60, price: 65 }
  ]
});
check("Y edit loads both lines", edit.lines.length === 2);
check("O edit preserves stored prices", edit.lines[0].price === 55 && edit.lines[1].price === 65);
check("save disabled until a change", form.canSave(edit) === false);
form.addLine(edit);
check("Z add service during edit", edit.lines.length === 3 && form.isEditDirty(edit) === true);
form.removeLine(edit, edit.lines[2].key);
check("AA remove added edit line", edit.lines.length === 2);
form.setLineStart(edit, edit.lines[1].key, edit.lines[1].startMin);
edit.lines[1].providerId = "anna";
form.derive(edit);
check("AB change provider only on one line", edit.lines[0].providerId === "koko" && edit.lines[1].providerId === "anna");
form.setLineStart(edit, edit.lines[0].key, 11 * 60);
check("AC change time only on one line", edit.lines[0].startMin === 11 * 60 && edit.lines[1].startMin === 12 * 60 + 45);

const patch = form.editPatch(edit);
check("edit patch sends every remaining line", patch.serviceLines.length === 2);
check("same-service line preserves price snapshot", patch.serviceLines[0].preservePriceSnapshot === true && patch.serviceLines[0].priceSnapshot === 55);

const html = form.linesHtml(state, [
  { id: "koko", firstName: "Koko" },
  { id: "bobo", firstName: "Bobo" }
]);
check("editor renders both lines", html.indexOf("Service 1") !== -1 && html.indexOf("Service 2") !== -1);
check("remove is subtle not a danger button", html.indexOf("ff-appt-line-remove") !== -1 && html.indexOf("ff-apd-danger") === -1);

check("duration 45 stays minutes", form.formatDurationLabel(45) === "45 min");
check("duration 60 is 1 hr", form.formatDurationLabel(60) === "1 hr");
check("duration 75 is 1 hr 15 min", form.formatDurationLabel(75) === "1 hr 15 min");
check("duration 105 is 1 hr 45 min", form.formatDurationLabel(105) === "1 hr 45 min");
check("duration never prints raw minutes over an hour", form.formatDurationLabel(105).indexOf("105 min") === -1);

const createHtml = form.createLinesHtml(state, [
  { id: "koko", firstName: "Koko" },
  { id: "bobo", firstName: "Bobo" }
]);
check("create UI renders service cards", createHtml.indexOf("ff-appt-card") !== -1 && createHtml.indexOf("Service 1") === -1);
check("create UI shows a time strip", createHtml.indexOf("ff-appt-strip") !== -1);
check("create UI is not a with/at/for form", createHtml.indexOf(">with<") === -1 && createHtml.indexOf(">at<") === -1 && createHtml.indexOf(">for<") === -1);
check("create UI shows human duration", createHtml.indexOf("1 hr") !== -1 && createHtml.indexOf("60 min") === -1);
check("create UI keeps line keys", createHtml.indexOf(state.lines[0].key) !== -1 && createHtml.indexOf(state.lines[1].key) !== -1);
check("create UI numbers connected service cards", createHtml.indexOf("ff-appt-rail-node") !== -1 && createHtml.indexOf(">1<") !== -1 && createHtml.indexOf(">2<") !== -1);
check("create total uses line prices", form.linesTotal(state) === 120);

const overlap = form.emptyState({ locationId: "locA", dateKey: "2026-08-24", startMin: 10 * 60 + 30, providerId: "koko" });
overlap.lines[0].services = [{ id: "mani", name: "Manicure", durationMinutes: 60, price: 55, raw: { durationMinutes: 60, defaultPrice: 55 } }];
form.setLineService(overlap, overlap.lines[0].key, "mani");
form.addLine(overlap);
overlap.lines[1].providerId = "bobo";
overlap.lines[1].services = [{ id: "pedi", name: "Pedicure", durationMinutes: 30, price: 31, raw: { durationMinutes: 30, defaultPrice: 31 } }];
form.setLineService(overlap, overlap.lines[1].key, "pedi");
form.setLineStart(overlap, overlap.lines[1].key, 10 * 60 + 30);
const overlapHtml = form.createLinesHtml(overlap, [
  { id: "koko", firstName: "Koko" },
  { id: "bobo", firstName: "Bobo" }
]);
check("overlapping different providers still render both cards", overlapHtml.indexOf("Manicure") !== -1 && overlapHtml.indexOf("Pedicure") !== -1);
check("overlapping lines keep both start times", overlapHtml.indexOf("10:30") !== -1);
check("hold still has one block per overlapping line", form.holdSpec(overlap).lines.length === 2);

const emptyCreate = form.emptyState({ locationId: "locA", dateKey: "2026-08-24", startMin: 735 });
check("empty create line is a search row", form.createLinesHtml(emptyCreate, []).indexOf("Search or select service") !== -1);

emptyCreate.catalogServices = [
  { id: "mani", name: "Manicure", category: "Hands", price: 43 },
  { id: "pedi", name: "Pedicure", category: "Feet", price: 58 }
];
const pickerOpen = form.createLinesHtml(emptyCreate, [], { servicePickerKey: emptyCreate.lines[0].key });
check("service picker groups are collapsible", pickerOpen.indexOf("toggle-service-cat") !== -1 && pickerOpen.indexOf("Hands") !== -1 && pickerOpen.indexOf("Feet") !== -1);
const pickerCollapsed = form.createLinesHtml(emptyCreate, [], {
  servicePickerKey: emptyCreate.lines[0].key,
  collapsedCats: { Feet: true }
});
check("service picker can collapse a category", pickerCollapsed.indexOf("is-collapsed") !== -1);
const pickerSearch = form.createLinesHtml(emptyCreate, [], {
  servicePickerKey: emptyCreate.lines[0].key,
  serviceQ: "pedi",
  collapsedCats: { Feet: true }
});
check("search keeps matching category open", pickerSearch.indexOf("is-collapsed") === -1 && pickerSearch.indexOf("Pedicure") !== -1);

check("empty serviceLines rejected", model.normalizeCreateInput({
  clientId: "cli_1",
  locationId: "locA",
  serviceLines: []
}).code === "INVALID_LINE");

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All multi-service appointment helper tests passed.");
