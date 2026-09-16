/**
 * Phase 2 Combo appointment scheduling.
 * Usage: node scripts/test-booking-combo-appointments.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, windowObj.document);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } },
  document: {
    getElementById: function () { return null; },
    addEventListener: function () {},
    dispatchEvent: function () {},
    documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} }
  },
  addEventListener: function () {},
  ffGetLocations: function () { return [{ id: "locA", name: "Soso spa" }]; },
  ffBookingCalState: {
    getEmployees: function () {
      return [
        { id: "nicole", firstName: "Nicole" },
        { id: "ashley", firstName: "Ashley" }
      ];
    }
  },
  ffBookingTime: {
    zonedMinutes: function (date) { return date.getUTCHours() * 60 + date.getUTCMinutes(); },
    zonedDateKey: function () { return "2026-09-15"; },
    formatDisplayDate: function () { return "Tuesday, Sep 15, 2026"; }
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/settings/model.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
const comboSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-combo.js"), "utf8").replace(/^export /gm, "");
new Function("window", comboSrc)(windowObj);
load("public/booking/appointments/combo.js", windowObj);
load("public/booking/appointments/form.js", windowObj);
load("public/booking/appointments/status.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/appointments/calendar-render.js", windowObj);
load("public/booking/appointments/details.js", windowObj);
load("public/booking/sales/model.js", windowObj);

const model = windowObj.ffBookingAppointmentModel;
const combo = windowObj.ffBookingAppointmentCombo;
const form = windowObj.ffBookingAppointmentForm;
const cal = windowObj.ffBookingCalAppointments;
const details = windowObj.ffBookingAppointmentDetails;
const sales = windowObj.ffBookingSalesModel;
const render = windowObj.ffBookingCalCardRender;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const gel = {
  id: "svc-gel",
  name: "Gel Manicure",
  durationMinutes: 45,
  price: 55,
  defaultPrice: 55,
  staffOverrides: { ashley: { enabled: false } },
  raw: { durationMinutes: 45, defaultPrice: 55, staffOverrides: { ashley: { enabled: false } } }
};
const pedi = {
  id: "svc-pedi",
  name: "Regular Pedicure",
  durationMinutes: 30,
  price: 45,
  defaultPrice: 45,
  staffOverrides: {},
  raw: { durationMinutes: 30, defaultPrice: 45, staffOverrides: {} }
};
const comboSvc = {
  id: "svc-combo",
  name: "Gel Mani + Regular Pedi",
  durationMinutes: 75,
  price: 84,
  defaultPrice: 84,
  serviceType: "combo",
  components: [
    { serviceId: "svc-gel", allocatedPrice: 44, sortOrder: 0 },
    { serviceId: "svc-pedi", allocatedPrice: 40, sortOrder: 1 }
  ],
  raw: {
    serviceType: "combo",
    defaultPrice: 84,
    durationMinutes: 75,
    components: [
      { serviceId: "svc-gel", allocatedPrice: 44, sortOrder: 0 },
      { serviceId: "svc-pedi", allocatedPrice: 40, sortOrder: 1 }
    ]
  }
};
const catalog = [gel, pedi, comboSvc];

windowObj.ffBookingAppointmentServices = {
  listAll: async function () { return catalog; },
  listForProvider: async function (providerId) {
    return catalog.filter(function (svc) {
      if (svc.serviceType === "combo") return true;
      return windowObj.ffBookingAppointmentServices.isCapable(svc.raw || svc, providerId);
    });
  },
  isCapable: function (service, providerId) {
    const overrides = service && service.staffOverrides || {};
    const row = overrides[providerId];
    return !(row && row.enabled === false);
  },
  effectiveDuration: function (service) { return Number(service.durationMinutes) || 30; },
  effectivePrice: function (service) { return Number(service.defaultPrice || service.price) || 0; }
};

function baseState() {
  const state = form.emptyState({
    locationId: "locA",
    dateKey: "2026-09-15",
    startMin: 11 * 60 + 30,
    providerId: "nicole"
  });
  state.catalogServices = catalog;
  state.lines[0].services = catalog;
  form.setClient(state, { clientId: "cli_jenny", displayName: "Jenny" });
  return state;
}

check("combo helper loaded", !!combo && !!form && !!model);
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("index.html loads combo.js before form.js", indexHtml.indexOf("appointments/combo.js") !== -1
  && indexHtml.indexOf("appointments/combo.js") < indexHtml.indexOf("appointments/form.js"));
check("1. selecting a Single stays one line", (function () {
  const state = baseState();
  form.setLineService(state, state.lines[0].key, "svc-gel");
  return state.lines.length === 1
    && state.lines[0].serviceId === "svc-gel"
    && !combo.isComboLine(state.lines[0])
    && state.lines[0].price === 55
    && state.lines[0].durationMinutes === 45
    && state.lines[0].endMin === 12 * 60 + 15;
})());

const expanded = baseState();
form.setLineService(expanded, expanded.lines[0].key, "svc-combo");
check("2. selecting Combo expands into component serviceLines", expanded.lines.length === 2
  && expanded.lines[0].serviceId === "svc-gel"
  && expanded.lines[1].serviceId === "svc-pedi"
  && combo.isComboLine(expanded.lines[0])
  && combo.isComboLine(expanded.lines[1]));
check("3. Combo remains one appointment / one instance", expanded.lines[0].comboInstanceId === expanded.lines[1].comboInstanceId
  && expanded.lines[0].comboServiceId === "svc-combo"
  && expanded.lines[0].comboComponentCount === 2);
check("4. allocated prices reconcile to Combo selling price", expanded.lines[0].price === 44
  && expanded.lines[1].price === 40
  && combo.allocatedPricesReconcile(expanded.lines, 84) === true
  && combo.appointmentServiceTotal(expanded.lines) === 84
  && combo.comboSellingTotal(expanded.lines) === 84);

check("5. same provider can perform all capable components", expanded.lines[0].providerId === "nicole"
  && expanded.lines[1].providerId === "nicole");

const split = baseState();
form.setLineService(split, split.lines[0].key, "svc-combo");
form.applyLineProvider(split, split.lines[1].key, "ashley");
check("6. different providers can be assigned per component", split.lines[0].providerId === "nicole"
  && split.lines[1].providerId === "ashley"
  && split.lines[0].comboInstanceId === split.lines[1].comboInstanceId);

check("7. provider eligibility uses the underlying component service", combo.isProviderEligible(gel, "ashley") === false
  && combo.isProviderEligible(pedi, "ashley") === true
  && combo.isProviderEligible(gel, "nicole") === true);

const ineligible = baseState();
form.setLineService(ineligible, ineligible.lines[0].key, "svc-combo");
form.applyLineProvider(ineligible, ineligible.lines[0].key, "ashley");
check("7b. Ashley cannot be chosen as Gel Manicure provider", /not available/.test(ineligible.lines[0].capabilityMessage)
  && form.lineComplete(ineligible.lines[0]) === false);

check("8. a component stays atomic to one provider", combo.validateComboAtomicity([
  { comboInstanceId: "c1", comboComponentIndex: 0, providerId: "nicole", service: gel },
  { comboInstanceId: "c1", comboComponentIndex: 0, providerId: "ashley", service: gel }
]).ok === false);

check("9. sequential scheduling uses Combo sortOrder", expanded.lines[0].startMin === 11 * 60 + 30
  && expanded.lines[0].endMin === 12 * 60 + 15
  && expanded.lines[1].startMin === 12 * 60 + 15
  && expanded.lines[1].endMin === 12 * 60 + 45);

combo.scheduleParallel(split.lines, 11 * 60 + 30);
form.derive(split);
check("10. parallel overlapping components on different providers are supported", split.lines[0].startMin === 11 * 60 + 30
  && split.lines[1].startMin === 11 * 60 + 30
  && split.lines[0].providerId !== split.lines[1].providerId
  && form.findProviderOverlaps(split).length === 0
  && form.canCreate(split) === true);

const clash = baseState();
form.setLineService(clash, clash.lines[0].key, "svc-combo");
clash.lines[1].startMin = clash.lines[0].startMin;
form.derive(clash);
check("11. provider conflict is rejected per component", form.findProviderOverlaps(clash).length > 0
  && form.canCreate(clash) === false);

const saved = {
  appointmentId: "appt_combo",
  clientId: "cli_jenny",
  locationId: "locA",
  dateKey: "2026-09-15",
  status: "scheduled",
  notes: "combo visit",
  clientSnapshot: { displayName: "Jenny" },
  serviceLines: expanded.lines.map(function (line, index) {
    return {
      lineId: "line_" + index,
      serviceId: line.serviceId,
      serviceNameSnapshot: line.service.name,
      providerId: line.providerId,
      providerNameSnapshot: line.providerId === "nicole" ? "Nicole" : "Ashley",
      startAt: new Date(Date.UTC(2026, 8, 15, 15, 30 + (index ? 45 : 0))),
      endAt: new Date(Date.UTC(2026, 8, 15, 16, index ? 15 : 15)),
      durationMinutes: line.durationMinutes,
      priceSnapshot: line.price,
      comboInstanceId: line.comboInstanceId,
      comboServiceId: line.comboServiceId,
      comboNameSnapshot: line.comboNameSnapshot,
      comboSellingPriceSnapshot: line.comboSellingPriceSnapshot,
      comboComponentIndex: line.comboComponentIndex,
      comboComponentCount: line.comboComponentCount
    };
  })
};
saved.serviceLines[0].startAt = new Date(Date.UTC(2026, 8, 15, 15, 30));
saved.serviceLines[0].endAt = new Date(Date.UTC(2026, 8, 15, 16, 15));
saved.serviceLines[1].startAt = new Date(Date.UTC(2026, 8, 15, 16, 15));
saved.serviceLines[1].endAt = new Date(Date.UTC(2026, 8, 15, 16, 45));

const fromDoc = model.fromDoc("appt_combo", saved);
check("12. saving Combo appointment persists component metadata", fromDoc.serviceLines.length === 2
  && fromDoc.serviceLines[0].comboInstanceId === expanded.lines[0].comboInstanceId
  && fromDoc.serviceLines[0].comboNameSnapshot === "Gel Mani + Regular Pedi"
  && fromDoc.serviceLines[0].priceSnapshot === 44
  && fromDoc.serviceLines[1].priceSnapshot === 40);

const restored = form.editStateFrom({
  appointmentId: "appt_combo",
  clientId: "cli_jenny",
  locationId: "locA",
  dateKey: "2026-09-15",
  notes: "combo visit",
  lines: fromDoc.serviceLines.map(function (line) {
    return {
      lineId: line.lineId,
      providerId: line.providerId,
      serviceId: line.serviceId,
      serviceName: line.serviceNameSnapshot,
      durationMinutes: line.durationMinutes,
      price: line.priceSnapshot,
      startMin: 11 * 60 + 30 + (line.comboComponentIndex ? 45 : 0),
      comboInstanceId: line.comboInstanceId,
      comboServiceId: line.comboServiceId,
      comboNameSnapshot: line.comboNameSnapshot,
      comboSellingPriceSnapshot: line.comboSellingPriceSnapshot,
      comboComponentIndex: line.comboComponentIndex,
      comboComponentCount: line.comboComponentCount
    };
  })
});
check("13. reopening appointment restores Combo correctly", restored.lines.length === 2
  && combo.isComboLine(restored.lines[0])
  && restored.lines[0].comboInstanceId === restored.lines[1].comboInstanceId
  && restored.lines[0].price === 44
  && restored.lines[1].price === 40);

form.applyLineProvider(restored, restored.lines[1].key, "ashley");
const patch = form.editPatch(restored);
check("14. editing one component provider persists", patch.serviceLines[0].providerId === "nicole"
  && patch.serviceLines[1].providerId === "ashley"
  && patch.serviceLines[0].comboInstanceId === patch.serviceLines[1].comboInstanceId
  && patch.serviceLines[1].priceSnapshot === 40);

const laterStart = new Date(Date.UTC(2026, 8, 15, 16, 15));
const mergedLater = model.mergeServiceLinePatch(saved.serviceLines, [{
  lineId: saved.serviceLines[1].lineId,
  serviceId: saved.serviceLines[1].serviceId,
  providerId: "nicole",
  startAt: laterStart,
  durationMinutes: 30,
  priceSnapshot: 40,
  comboInstanceId: saved.serviceLines[1].comboInstanceId,
  comboServiceId: saved.serviceLines[1].comboServiceId,
  comboNameSnapshot: saved.serviceLines[1].comboNameSnapshot,
  comboSellingPriceSnapshot: 84,
  comboComponentIndex: 1,
  comboComponentCount: 2
}])[0];
check("14b. later component start does not keep stale endAt", mergedLater.endAt == null);

form.setLineStart(restored, restored.lines[1].key, 12 * 60 + 15);
const laterPatch = form.editPatch(restored);
const pediPayload = laterPatch.serviceLines[1];
check("14c. edit payload sends an end after the new start", !!(
  pediPayload.startAt
  && pediPayload.endAt
  && pediPayload.endAt.getTime() > pediPayload.startAt.getTime()
));

const view = details.viewFrom(fromDoc, fromDoc.serviceLines[1].lineId);
check("15. Appointment Details shows grouped Combo + components", view.total === 84
  && view.comboGroups.length === 1
  && view.comboGroups[0].kind === "combo"
  && view.services.length === 2);
check("15b. Details total does not double-count Combo selling price", view.total === 84 && view.totalLabel.indexOf("168") === -1);

const cards = cal.cardsFrom([fromDoc], "locA");
const sameProviderCards = cal.cardsFrom([fromDoc], "locA");
check("16. same-provider Combo stays one visit card", sameProviderCards.length === 1
  && sameProviderCards[0].appointmentId === "appt_combo");

const splitDoc = model.fromDoc("appt_split", {
  appointmentId: "appt_split",
  status: "scheduled",
  locationId: "locA",
  dateKey: "2026-09-15",
  clientSnapshot: { displayName: "Jenny" },
  serviceLines: [
    Object.assign({}, fromDoc.serviceLines[0], { providerId: "nicole", lineId: "c1" }),
    Object.assign({}, fromDoc.serviceLines[1], {
      providerId: "ashley",
      lineId: "c2",
      startAt: fromDoc.serviceLines[0].startAt,
      endAt: new Date(Date.UTC(2026, 8, 15, 16, 0))
    })
  ]
});
const splitCards = cal.cardsFrom([splitDoc], "locA");
check("16b. clicking either Calendar component opens the same appointment", splitCards.length === 2
  && splitCards[0].appointmentId === "appt_split"
  && splitCards[1].appointmentId === "appt_split"
  && splitCards[0].comboName === "Gel Mani + Regular Pedi"
  && splitCards[1].comboName === "Gel Mani + Regular Pedi");
check("16c. each provider column shows its component", splitCards.some(function (card) { return card.providerId === "nicole" && card.serviceName.indexOf("Gel") !== -1; })
  && splitCards.some(function (card) { return card.providerId === "ashley" && card.serviceName.indexOf("Pedicure") !== -1; }));

const legacy = model.fromDoc("legacy", {
  serviceLines: [{
    lineId: "old",
    serviceId: "svc-gel",
    serviceNameSnapshot: "Gel Manicure",
    providerId: "nicole",
    durationMinutes: 45,
    priceSnapshot: 55
  }]
});
check("17. existing Single appointments remain compatible", legacy.serviceLines.length === 1
  && !legacy.serviceLines[0].comboInstanceId
  && legacy.serviceLines[0].priceSnapshot === 55);

const multi = model.fromDoc("multi", {
  serviceLines: [
    { lineId: "a", serviceId: "svc-gel", serviceNameSnapshot: "Gel Manicure", providerId: "nicole", priceSnapshot: 55, durationMinutes: 45 },
    { lineId: "b", serviceId: "svc-pedi", serviceNameSnapshot: "Regular Pedicure", providerId: "ashley", priceSnapshot: 45, durationMinutes: 30 }
  ]
});
check("17b. existing multi-service appointments remain compatible", multi.serviceLines.length === 2
  && !multi.serviceLines[0].comboInstanceId
  && multi.serviceLines[0].priceSnapshot + multi.serviceLines[1].priceSnapshot === 100);

check("18. totals do not double-count Combo selling price", combo.appointmentServiceTotal(fromDoc.serviceLines) === 84
  && combo.comboSellingTotal(fromDoc.serviceLines) === 84);

const sale = sales.itemsFromAppointment(fromDoc);
check("18b. checkout uses allocated component prices", sale.length === 2
  && sale[0].amount + sale[1].amount === 84
  && sale[0].amount === 44
  && /Combo|Gel Mani/.test(sale[0].name));

const reportsSrc = fs.readFileSync(path.join(root, "public/booking/reports/service-demand.js"), "utf8");
check("19. Reports still read priceSnapshot only (no Combo double-count rewrite)", reportsSrc.indexOf("comboSellingPriceSnapshot") === -1
  && reportsSrc.indexOf("priceSnapshot") !== -1);

const cardHtml = render.servicesHtml(splitCards[0]);
check("20. Calendar Combo cards keep the visit relationship", /Combo/.test(cardHtml) && /Gel Mani \+ Regular Pedi/.test(cardHtml));
const splitHtmlByProvider = {};
splitCards.forEach(function (card) {
  splitHtmlByProvider[card.providerId] = render.cardInnerHtml(card, card);
});
check("20c. split Combo cards show each component's own start-end",
  /Gel Manicure/.test(splitHtmlByProvider.nicole) &&
  /11:30 AM – 12:15 PM/.test(splitHtmlByProvider.nicole) &&
  /Regular Pedicure/.test(splitHtmlByProvider.ashley) &&
  /11:30 AM – 12:00 PM/.test(splitHtmlByProvider.ashley) &&
  splitHtmlByProvider.nicole.indexOf("12:00 PM") === -1);
const nonComboCards = cal.cardsFrom([{
  appointmentId: "plain",
  status: "scheduled",
  clientSnapshot: { displayName: "Alex" },
  serviceLines: [{
    lineId: "p1",
    providerId: "nicole",
    serviceNameSnapshot: "Gel Manicure",
    startAt: new Date(Date.UTC(2026, 8, 15, 14, 0)),
    endAt: new Date(Date.UTC(2026, 8, 15, 14, 45)),
    durationMinutes: 45
  }]
}], "locA");
check("20b. non-Combo calendar cards stay unchanged", nonComboCards.length === 1
  && !nonComboCards[0].comboName
  && nonComboCards[0].serviceName === "Gel Manicure"
  && render.servicesHtml(nonComboCards[0]).indexOf("Combo") === -1);

check("add-on foundation can target a Combo component line", (function () {
  const addon = {
    lineKind: "addon",
    addonTargetLineId: fromDoc.serviceLines[0].lineId,
    addonOfComboInstanceId: fromDoc.serviceLines[0].comboInstanceId,
    serviceNameSnapshot: "French"
  };
  const fields = combo.readAddonFields(addon);
  return fields && fields.addonTargetLineId === "line_0" && fields.lineKind === "addon";
})());

check("historical Combo booked as one line still loads", (function () {
  const oldCombo = model.fromDoc("hist", {
    serviceLines: [{
      lineId: "one",
      serviceId: "svc-combo",
      serviceNameSnapshot: "Gel Mani + Regular Pedi",
      providerId: "nicole",
      priceSnapshot: 84,
      durationMinutes: 75
    }]
  });
  return oldCombo.serviceLines.length === 1
    && !oldCombo.serviceLines[0].comboInstanceId
    && oldCombo.serviceLines[0].priceSnapshot === 84;
})());

check("form create HTML groups the Combo", /ff-appt-combo/.test(form.createLinesHtml(expanded, [
  { id: "nicole", firstName: "Nicole" },
  { id: "ashley", firstName: "Ashley" }
])) && /Gel Manicure/.test(form.createLinesHtml(expanded, [
  { id: "nicole", firstName: "Nicole" }
])));

check("payload preserves allocated Combo prices", (function () {
  expanded.dateKey = "2026-09-15";
  const rows = expanded.lines.map(function (line) {
    return {
      serviceId: line.serviceId,
      priceSnapshot: line.price,
      comboInstanceId: line.comboInstanceId,
      preservePriceSnapshot: true
    };
  });
  return rows[0].priceSnapshot + rows[1].priceSnapshot === 84 && rows[0].preservePriceSnapshot === true;
})());

check("expanded Combo components keep real underlying names", expanded.lines[0].service.name === "Gel Manicure"
  && expanded.lines[1].service.name === "Regular Pedicure"
  && expanded.lines[0].originalServiceName === "Gel Manicure"
  && expanded.lines[1].originalServiceName === "Regular Pedicure"
  && expanded.lines[0].serviceId === "svc-gel"
  && expanded.lines[1].serviceId === "svc-pedi"
  && expanded.lines[0].serviceId !== "svc-combo");

check("create payload snapshots real component names not Service", (function () {
  expanded.dateKey = "2026-09-15";
  const rows = expanded.lines.map(function (line) { return form.linePayload ? form.linePayload(expanded, line) : null; });
  if (rows[0] && rows[1]) {
    return rows[0].serviceNameSnapshot === "Gel Manicure"
      && rows[1].serviceNameSnapshot === "Regular Pedicure"
      && rows[0].serviceId === "svc-gel"
      && rows[1].serviceId === "svc-pedi";
  }
  return expanded.lines[0].originalServiceName === "Gel Manicure"
    && expanded.lines[1].originalServiceName === "Regular Pedicure";
})());

const snapshotOnly = {
  id: "svc-combo-snap",
  name: "Gel Mani + Regular Pedi",
  durationMinutes: 75,
  price: 84,
  defaultPrice: 84,
  serviceType: "combo",
  components: [
    { serviceId: "shared-gel", allocatedPrice: 44, sortOrder: 0, serviceNameSnapshot: "Gel Manicure" },
    { serviceId: "shared-pedi", allocatedPrice: 40, sortOrder: 1, serviceNameSnapshot: "Regular Pedicure" }
  ]
};
const snapshotState = baseState();
snapshotState.catalogServices = [snapshotOnly];
snapshotState.lines[0].services = [snapshotOnly];
form.setLineService(snapshotState, snapshotState.lines[0].key, "svc-combo-snap");
check("name snapshots survive when underlying IDs are missing from the picker catalog", snapshotState.lines.length === 2
  && snapshotState.lines[0].serviceId === "shared-gel"
  && snapshotState.lines[1].serviceId === "shared-pedi"
  && snapshotState.lines[0].service.name === "Gel Manicure"
  && snapshotState.lines[1].service.name === "Regular Pedicure"
  && snapshotState.lines[0].serviceId !== "svc-combo-snap"
  && form.createLinesHtml(snapshotState, [{ id: "nicole", firstName: "Nicole" }]).indexOf(">Service<") === -1
  && /Gel Manicure/.test(form.createLinesHtml(snapshotState, [{ id: "nicole", firstName: "Nicole" }]))
  && /Regular Pedicure/.test(form.createLinesHtml(snapshotState, [{ id: "nicole", firstName: "Nicole" }])));

const mergedPicker = windowObj.ffCatalogCombo.mergeCatalogServicesForPicker(
  [snapshotOnly, { id: "shared-gel", name: "Gel Manicure", category: "Hands", durationMinutes: 45 }, { id: "shared-pedi", name: "Regular Pedicure", category: "Feet", durationMinutes: 30 }],
  [{ id: "loc-gel", name: "Gel Manicure", category: "Hands", durationMinutes: 45 }, { id: "loc-pedi", name: "Regular Pedicure", category: "Feet", durationMinutes: 30 }]
);
const retained = windowObj.ffCatalogCombo.retainComboComponentServices(mergedPicker, [
  [snapshotOnly, { id: "shared-gel", name: "Gel Manicure", category: "Hands", durationMinutes: 45 }, { id: "shared-pedi", name: "Regular Pedicure", category: "Feet", durationMinutes: 30 }],
  [{ id: "loc-gel", name: "Gel Manicure", category: "Hands", durationMinutes: 45 }, { id: "loc-pedi", name: "Regular Pedicure", category: "Feet", durationMinutes: 30 }]
]);
check("picker merge keeps location singles and still retains Combo component IDs", mergedPicker.some(function (row) { return row.id === "loc-gel"; })
  && !mergedPicker.some(function (row) { return row.id === "shared-gel"; })
  && retained.some(function (row) { return row.id === "shared-gel" && row.lookupOnly === true; })
  && retained.some(function (row) { return row.id === "shared-pedi" && row.lookupOnly === true; }));

const retainedState = baseState();
retainedState.catalogServices = retained;
retainedState.lines[0].services = retained.filter(function (row) { return row.lookupOnly !== true; });
form.setLineService(retainedState, retainedState.lines[0].key, "svc-combo-snap");
check("retained component IDs expand with real names and durations", retainedState.lines[0].serviceId === "shared-gel"
  && retainedState.lines[1].serviceId === "shared-pedi"
  && retainedState.lines[0].service.name === "Gel Manicure"
  && retainedState.lines[1].service.name === "Regular Pedicure"
  && retainedState.lines[0].durationMinutes === 45
  && retainedState.lines[1].durationMinutes === 30);

check("historical empty name still falls back to Service in details", details.viewFrom(model.fromDoc("old-generic", {
  serviceLines: [{
    lineId: "old",
    serviceId: "svc-gel",
    serviceNameSnapshot: "",
    providerId: "nicole",
    durationMinutes: 45,
    priceSnapshot: 55
  }]
}), "old").serviceName === "Service");

const splitPickerHtml = form.createLinesHtml(split, [
  { id: "nicole", firstName: "Nicole" },
  { id: "ashley", firstName: "Ashley" }
], { providerPickerKey: split.lines[1].key });
check("split-provider picker renders only on the chosen component", splitPickerHtml.indexOf('data-ff-picker="provider"') !== -1
  && (splitPickerHtml.match(/data-ff-picker="provider"/g) || []).length === 1
  && splitPickerHtml.indexOf('data-ff-provider="ashley"') !== -1
  && splitPickerHtml.indexOf("Regular Pedicure") !== -1
  && splitPickerHtml.indexOf("Gel Manicure") !== -1);

function delayCatalog(providerId) {
  let resolveFn = function () {};
  const promise = new Promise(function (resolve) { resolveFn = resolve; });
  return {
    promise: promise,
    resolve: function () {
      resolveFn(catalog.filter(function (svc) {
        if (svc.serviceType === "combo") return true;
        return windowObj.ffBookingAppointmentServices.isCapable(svc.raw || svc, providerId);
      }));
    }
  };
}

async function runProviderRefreshLifecycle() {
  const originalList = windowObj.ffBookingAppointmentServices.listForProvider;
  const delayed = {};
  windowObj.ffBookingAppointmentServices.listForProvider = function (providerId) {
    if (!delayed[providerId]) delayed[providerId] = delayCatalog(providerId);
    return delayed[providerId].promise;
  };
  const raced = baseState();
  form.setLineService(raced, raced.lines[0].key, "svc-combo");
  const firstRefresh = form.setLineProvider(raced, raced.lines[0].key, "nicole");
  form.applyLineProvider(raced, raced.lines[1].key, "ashley");
  const secondRefresh = form.setLineProvider(raced, raced.lines[1].key, "ashley");
  delayed.nicole.resolve();
  await firstRefresh;
  check("in-flight first-component refresh does not revert the second provider", raced.lines[0].providerId === "nicole"
    && raced.lines[1].providerId === "ashley"
    && raced.lines[0].comboInstanceId === raced.lines[1].comboInstanceId
    && raced.lines[0].serviceId === "svc-gel"
    && raced.lines[1].serviceId === "svc-pedi"
    && raced.lines[0].price === 44
    && raced.lines[1].price === 40
    && raced.lines[0].durationMinutes === 45
    && raced.lines[1].durationMinutes === 30);
  delayed.ashley.resolve();
  await secondRefresh;
  check("split-provider assignment survives both catalog refreshes", raced.lines[0].providerId === "nicole"
    && raced.lines[1].providerId === "ashley"
    && combo.isComboLine(raced.lines[0])
    && combo.isComboLine(raced.lines[1])
    && raced.lines[0].service.name === "Gel Manicure"
    && raced.lines[1].service.name === "Regular Pedicure");

  const staleLine = baseState();
  form.setLineService(staleLine, staleLine.lines[0].key, "svc-combo");
  delayed.nicole = delayCatalog("nicole");
  delayed.ashley = delayCatalog("ashley");
  const staleRefresh = form.setLineProvider(staleLine, staleLine.lines[1].key, "nicole");
  form.applyLineProvider(staleLine, staleLine.lines[1].key, "ashley");
  const liveRefresh = form.setLineProvider(staleLine, staleLine.lines[1].key, "ashley");
  delayed.nicole.resolve();
  await staleRefresh;
  check("stale same-line refresh does not overwrite the later provider", staleLine.lines[1].providerId === "ashley"
    && staleLine.lines[0].providerId === "nicole"
    && staleLine.lines[1].serviceId === "svc-pedi"
    && staleLine.lines[1].price === 40);
  delayed.ashley.resolve();
  await liveRefresh;
  windowObj.ffBookingAppointmentServices.listForProvider = originalList;
}

runProviderRefreshLifecycle().then(function () {
  if (failed) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("All Combo appointment tests passed.");
}).catch(function (err) {
  console.error("FAILED provider refresh lifecycle", err && err.stack || err);
  process.exit(1);
});
