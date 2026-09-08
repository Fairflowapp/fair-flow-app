/**
 * Booking Sales model and screen wiring. No Firestore writes.
 * Usage: node scripts/test-booking-sales.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const windowObj = {};
new Function("window", read("public/booking/sales/model.js"))(windowObj);
const model = windowObj.ffBookingSalesModel;

const appointment = {
  appointmentId: "A1",
  clientId: "cli_shiri",
  locationId: "locA",
  endAt: new Date("2026-09-06T21:15:00.000Z"),
  clientSnapshot: { displayName: "Shiri A" },
  serviceLines: [
    { lineId: "s1", serviceNameSnapshot: "mani", priceSnapshot: 32, providerNameSnapshot: "Nicole" },
    { lineId: "s2", serviceNameSnapshot: "Pedicure", priceSnapshot: 41, providerNameSnapshot: "Rebecca" }
  ]
};

const built = model.fromAppointment(appointment);
check("appointment checkout becomes a closed sale", !!(built.ok && built.fields.status === "closed" && built.fields.source === "appointment"));
check("sale date follows the visit", built.fields.closedAt === appointment.endAt);
check("sale keeps the client", built.fields.clientId === "cli_shiri" && built.fields.clientSnapshot.displayName === "Shiri A");
check("sale totals both services", built.fields.total === 73 && built.fields.items.length === 2);
const tipped = model.fromAppointment(appointment, { tip: 10 });
check("tip is added at the end of the sale", tipped.ok && tipped.fields.tip === 10 && tipped.fields.subtotal === 73 && tipped.fields.total === 83);
check("a blank tip stays zero", model.normalizeTip("") === 0 && model.normalizeTip(-4) === 0);
check("sale money is dollars", model.money(73) === "$73.00");
check("sale label uses the number", model.saleLabel({ saleNumber: 155487 }) === "Sale #155487");
check("closed status is Closed", model.statusLabel("closed") === "Closed");
check("search matches client name", model.matchesQuery({ saleNumber: 12, clientSnapshot: { displayName: "Shiri A" } }, "shiri"));
check("search matches sale number", model.matchesQuery({ saleNumber: 155487, clientSnapshot: { displayName: "Jenny" } }, "155487"));
check("missing client is rejected", model.normalizeCreate({ locationId: "locA", items: [{ name: "mani", amount: 32 }] }).ok === false);
check("empty cart is rejected", model.normalizeCreate({ locationId: "locA", clientId: "c1", items: [] }).ok === false);

const fromDoc = model.fromDoc("sale_1", {
  saleNumber: 9,
  locationId: "locA",
  clientId: "cli_jenny",
  clientSnapshot: { displayName: "Jenny" },
  status: "closed",
  items: [{ name: "mani", amount: 28 }],
  total: 28
});
check("fromDoc keeps the id and total", fromDoc.saleId === "sale_1" && fromDoc.total === 28 && fromDoc.clientSnapshot.displayName === "Jenny");
const dateEvent = model.historyFromPatch({
  status: "closed",
  closedAt: new Date("2026-09-06T16:00:00.000Z"),
  locationId: "locA",
  createdByName: "Tina"
}, { closedAt: new Date("2026-09-05T16:00:00.000Z") }, { name: "Tina" })[0];
check("date change is recorded", !!(dateEvent && dateEvent.type === "date_changed" && dateEvent.from && dateEvent.to && dateEvent.from !== dateEvent.to));
const reopenEvent = model.historyFromPatch({
  status: "closed",
  closedAt: new Date("2026-09-06T16:00:00.000Z"),
  createdByName: "Tina"
}, { status: "open" }, { name: "Ashley" })[0];
check("reopen is recorded", !!(reopenEvent && reopenEvent.type === "reopened" && reopenEvent.fromBy === "Tina"));
check("history explains the date change", model.historyLabel({ type: "date_changed", from: "September 6", to: "September 5", byName: "Tina" }).indexOf("from September 6 to September 5") !== -1);
check("history explains a refund", model.historyLabel({ type: "refunded", amount: 10, previousTotal: 31, byName: "Tina" }).indexOf("$10.00") !== -1 && model.historyLabel({ type: "refunded", amount: 10, previousTotal: 31, byName: "Tina" }).indexOf("$31.00") !== -1);
check("client since uses month and year", model.clientSinceLabel(new Date("2024-10-12T12:00:00.000Z")).indexOf("Client since") !== -1);
check("sale when includes the year", model.formatWhen(new Date("2026-09-06T20:15:00.000Z")).indexOf("2026") !== -1);

windowObj.ffBookingTime = {
  todayDateKey: function () { return "2026-09-06"; },
  addDays: function (key, days) {
    var d = new Date(key + "T12:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + Number(days) || 0);
    return d.toISOString().slice(0, 10);
  },
  parseDateKey: function (key) {
    var m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  },
  zonedDateKey: function (date) {
    return date && date.toISOString ? date.toISOString().slice(0, 10) : "";
  }
};
const saleA = {
  saleId: "s1",
  saleNumber: 2,
  locationId: "locA",
  status: "closed",
  source: "appointment",
  total: 73,
  method: "none",
  processor: "none",
  channel: "staff",
  closedAt: new Date("2026-09-06T16:00:00.000Z"),
  history: []
};
const saleB = {
  saleId: "s2",
  saleNumber: 9,
  locationId: "locB",
  status: "void",
  source: "online",
  total: 20,
  method: "card",
  processor: "fairflow",
  channel: "online",
  closedAt: new Date("2026-09-01T16:00:00.000Z"),
  history: [{ type: "refunded", amount: 20 }]
};
check("filter keeps this location by default", model.matchesFilters(saleA, model.defaultFilters()));
check("filter by location", model.matchesFilters(saleA, { locationId: "locB" }) === false && model.matchesFilters(saleB, { locationId: "locB" }));
check("filter by sale number", model.matchesFilters(saleA, { saleNumber: "2" }) && !model.matchesFilters(saleB, { saleNumber: "2" }));
check("filter by amount range", model.matchesFilters(saleA, { amountFrom: "50", amountTo: "80" }) && !model.matchesFilters(saleA, { amountFrom: "80" }));
check("today keeps today's sale", model.matchesFilters(saleA, { date: "today" }) && !model.matchesFilters(saleB, { date: "today" }));
const months = model.recentMonthPresets();
check("recent months are the last three named months", !!(months[0] && months[0].label === "August" && months[1].label === "July" && months[2].label === "June"));
const augustSale = Object.assign({}, saleB, { closedAt: new Date("2026-08-15T16:00:00.000Z") });
check("August filter keeps an August sale", model.matchesFilters(augustSale, { date: "month:2026-08" }) && !model.matchesFilters(saleA, { date: "month:2026-08" }));
check("refunded matches history", model.matchesFilters(saleB, { status: "refunded" }) && !model.matchesFilters(saleA, { status: "refunded" }));
check("reversed matches void", model.matchesFilters(saleB, { status: "reversed" }) && !model.matchesFilters(saleA, { status: "reversed" }));
check("method none matches current sales", model.matchesFilters(saleA, { method: "none" }) && !model.matchesFilters(saleA, { method: "card" }));
check("house discount is a method", model.matchesFilters(Object.assign({}, saleA, { method: "house_discount" }), { method: "house_discount" }) && !model.matchesFilters(saleA, { method: "house_discount" }));
check("processor none matches current sales", model.matchesFilters(saleA, { processor: "none" }) && !model.matchesFilters(saleA, { processor: "fairflow" }));
check("channel staff matches appointment sales", model.matchesFilters(saleA, { channel: "staff" }) && !model.matchesFilters(saleA, { channel: "self_checkout" }));
check("filtersAreActive notices a date", model.filtersAreActive({ date: "today" }) && !model.filtersAreActive(model.defaultFilters()));
const ui = read("public/booking/sales/ui.js");
const options = read("public/booking/sales/options.js");
check("sale details show location and who created it", ui.indexOf("Location") !== -1 && ui.indexOf("Created by") !== -1 && ui.indexOf("clientSinceLabel") !== -1);
check("sale details use the client photo when one exists", ui.indexOf("ff-sale-avatar") !== -1 && ui.indexOf("photoUrl") !== -1);
check("sale details can show history", ui.indexOf("ff-sale-history") !== -1);
check("history resolves the staff who changed it", ui.indexOf("historyActorName") !== -1);
const menu = read("public/booking/sales/menu.js");
check("sale actions use an arrow menu", menu.indexOf("Sale actions") !== -1 && menu.indexOf("polyline") !== -1);
check("sale menu has mangomint actions", menu.indexOf("Change Date") !== -1 && menu.indexOf("Add Notes") !== -1 && menu.indexOf("Reopen") !== -1 && menu.indexOf("Refund") !== -1 && menu.indexOf("Print Receipt") !== -1 && menu.indexOf("Send Receipt") !== -1);
check("refund does not invent a payment", menu.indexOf("card payments") !== -1);

const state = read("public/booking/state.js");
const sidebar = read("public/booking/sidebar.js");
const shell = read("public/booking/shell.js");
const data = read("public/booking/sales/data.js");
const apptData = read("public/booking/appointments/data.js");
const rules = read("firestore.rules");
const indexes = read("firestore.indexes.json");
const html = read("public/index.html");

check("sales is a booking section", state.indexOf("sales: true") !== -1);
check("sidebar has a Sales item", sidebar.indexOf('itemHtml("sales", "Sales"') !== -1);
check("shell paints a Sales page", shell.indexOf('data-ff-booking-page="sales"') !== -1);
check("shell refreshes sales", shell.indexOf("ffRefreshBookingSales") !== -1);
check("sales live under the salon", data.indexOf("salons/${salonId}/sales") !== -1);
check("checkout writes a sale from the appointment", apptData.indexOf("createFromAppointment") !== -1);
check("sales can update notes and date", data.indexOf("updateSale") !== -1);
check("sale actor uses the signed-in staff name", data.indexOf("__ff_authedStaffName") !== -1);
check("sales backfills completed visits", data.indexOf("backfillCompletedForDate") !== -1);
check("rules allow salon sales", rules.indexOf("match /salons/{salonId}/sales/{saleId}") !== -1);
check("indexes cover location sales", indexes.indexOf('"collectionGroup": "sales"') !== -1 && indexes.indexOf('"fieldPath": "closedAt"') !== -1);
check("index.html loads the sales screen", html.indexOf("/booking/sales/ui.js") !== -1 && html.indexOf("/booking/sales/sales.css") !== -1);
check("index.html loads sales filters", html.indexOf("/booking/sales/options.js") !== -1);
check("sales screen has a Filters button", ui.indexOf('data-ff-sale-act="filters"') !== -1 && ui.indexOf("Filters") !== -1);
check("filters drawer has location and sale number", options.indexOf("All locations") !== -1 && options.indexOf("Sale #") !== -1 && options.indexOf("From amount") !== -1);
check("filters drawer has date presets", options.indexOf("Today") !== -1 && options.indexOf("Yesterday") !== -1 && options.indexOf("Last week") !== -1 && options.indexOf("Last two weeks") !== -1 && options.indexOf("recentMonthPresets") !== -1 && options.indexOf("Custom period") !== -1 && options.indexOf("Last 3 months") === -1);
check("filters drawer has status method processor channel", options.indexOf("Refunded") !== -1 && options.indexOf("Reversed") !== -1 && options.indexOf("Credit Card") !== -1 && options.indexOf("Check") !== -1 && options.indexOf("Gift Card") !== -1 && options.indexOf("House Discount") !== -1 && options.indexOf("house_discount") !== -1 && options.indexOf("Has Discount") === -1 && options.indexOf('name="houseDiscount"') === -1 && options.indexOf("Fair Flow") !== -1 && options.indexOf("Staff member") !== -1 && options.indexOf("Self checkout") !== -1 && options.indexOf("Automatic charge") !== -1 && options.indexOf("Online booking") !== -1);
check("filters do not invent Point or MangoMint", options.indexOf("Point") === -1 && options.indexOf("MangoMint") === -1 && options.indexOf("Mangomint") === -1);
check("sales can list the whole salon", data.indexOf("listForSalon") !== -1);
check("shell closes sales filters", shell.indexOf("ffBookingSalesOptions") !== -1);
const checkout = read("public/booking/sales/checkout.js");
const details = read("public/booking/appointments/details.js");
check("checkout asks for a tip before completing", checkout.indexOf("ffSaleCkTip") !== -1 && checkout.indexOf("No tip") !== -1);
check("check out opens the tip step", details.indexOf("ffBookingSalesCheckout") !== -1 && details.indexOf('next === "completed"') !== -1);

if (failed) process.exit(1);
console.log("All Booking sales checks passed.");
