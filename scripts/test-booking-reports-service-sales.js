/**
 * Service Sales from closed checkout items. No Firestore.
 * Usage: node scripts/test-booking-reports-service-sales.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, { readyState: "complete" });
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
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/service-sales-compute.js", windowObj);
const api = windowObj.ffBookingReportsServiceSalesCompute;

function sale(partial) {
  return Object.assign({
    saleId: "s1",
    status: "closed",
    locationId: "loc",
    dateKey: "2026-09-10",
    items: [],
    subtotal: 0,
    tip: 0,
    total: 0
  }, partial);
}

function item(partial) {
  return Object.assign({
    kind: "service",
    name: "Gel Manicure",
    serviceId: "gel",
    providerId: "maria",
    providerName: "Maria",
    amount: 40
  }, partial);
}

const opts = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"] };

const twoServices = api.summarizeServiceSales([
  sale({
    items: [item(), item({ lineId: "2", name: "Blowout", serviceId: "blow", amount: 55 })]
  })
], opts);
check("A: two service items are two units", twoServices.totals.units === 2 && twoServices.totals.serviceTickets === 1);
check("A: gross is the sum of item amounts", twoServices.totals.grossSales === 95);
check("A: each service is its own row", twoServices.services.length === 2 && twoServices.services[0].sales === 55);

const mixed = api.summarizeServiceSales([
  sale({
    items: [item({ amount: 30 }), item({ kind: "product", name: "Serum", serviceId: "serum", amount: 18 })]
  })
], opts);
check("B: product items are excluded", mixed.totals.units === 1 && mixed.totals.grossSales === 30 && mixed.services.length === 1);

const skipped = api.summarizeServiceSales([
  sale({ status: "open", items: [item({ amount: 40 })] }),
  sale({ saleId: "void1", status: "void", items: [item({ amount: 40 })] }),
  sale({ saleId: "ok", items: [item({ amount: 12 })] })
], opts);
check("C: open and void tickets are excluded", skipped.totals.units === 1 && skipped.totals.grossSales === 12);

const ignorePrice = api.summarizeServiceSales([
  sale({
    items: [item({ amount: 25, priceSnapshot: 999 })],
    priceSnapshot: 888
  })
], opts);
check("D: checkout amount is used, not priceSnapshot", ignorePrice.totals.grossSales === 25);

const walkIn = api.summarizeServiceSales([
  sale({
    source: "walk_in",
    items: [{ kind: "service", name: "Cut", serviceId: "cut", amount: 45 }]
  })
], opts);
check("E: walk-in items without providerId are unassigned", walkIn.totals.unassignedUnits === 1 && walkIn.providers[0].name === "Unassigned" && walkIn.providers[0].assigned === false);

const assigned = api.summarizeServiceSales([
  sale({ items: [item({ amount: 40 })] })
], opts);
check("F: appointment checkout provider is kept", assigned.providers.length === 1 && assigned.providers[0].providerId === "maria" && assigned.providers[0].sales === 40);

const multi = api.summarizeServiceSales([
  sale({
    items: [
      item({ providerId: "maria", providerName: "Maria", amount: 40 }),
      item({ serviceId: "color", name: "Color", providerId: "anna", providerName: "Anna", amount: 90 })
    ]
  })
], opts);
check("G: one ticket can attribute two providers", multi.providers.length === 2 && multi.totals.serviceTickets === 1);

const sameId = api.summarizeServiceSales([
  sale({ items: [item({ name: "Gel Manicure", amount: 40 })] }),
  sale({ saleId: "s2", items: [item({ name: "Gel", amount: 42 })] }),
  sale({ saleId: "s3", items: [item({ name: "Gel Manicure", amount: 40 })] })
], opts);
check("H: same serviceId aggregates", sameId.services.length === 1 && sameId.services[0].units === 3 && sameId.services[0].sales === 122);
check("H: display name uses the more common snapshot", sameId.services[0].name === "Gel Manicure");

const byName = api.summarizeServiceSales([
  sale({ items: [item({ serviceId: "", name: "Add-on", amount: 10 })] }),
  sale({ saleId: "s2", items: [item({ serviceId: "", name: "Add-on", amount: 12 })] }),
  sale({ saleId: "s3", items: [item({ serviceId: "", name: "Other", amount: 8 })] })
], opts);
check("I: missing serviceId groups by name", byName.services.length === 2 && byName.services[0].name === "Add-on" && byName.services[0].units === 2);

const loc = api.summarizeServiceSales([
  sale({ locationId: "a", items: [item({ amount: 10 })] }),
  sale({ saleId: "s2", locationId: "b", items: [item({ amount: 20 })] })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["b"] });
check("J: other locations are excluded", loc.totals.grossSales === 20 && loc.totals.units === 1);

const ranged = api.summarizeServiceSales([
  sale({ dateKey: "2026-09-09", items: [item({ amount: 10 })] }),
  sale({ saleId: "s2", dateKey: "2026-09-10", items: [item({ amount: 20 })] }),
  sale({ saleId: "s3", dateKey: "2026-09-11", items: [item({ amount: 30 })] })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"] });
check("K: rows outside the civil range are excluded", ranged.totals.grossSales === 20 && ranged.days.length === 1);

const mix = api.summarizeServiceSales([
  sale({ items: [item({ amount: 75 })] }),
  sale({ saleId: "s2", items: [item({ serviceId: "cut", name: "Cut", amount: 25 })] })
], opts);
check("L: mix is share of gross service sales", mix.services[0].mix === 75 && mix.services[1].mix === 25);

check("M: average per unit is gross / units", mix.totals.averageUnit === 50 && mix.services[0].average === 75);
check("M: average ticket is gross / service tickets", mix.totals.averageTicket === 50 && mix.totals.serviceTickets === 2);

const empty = api.summarizeServiceSales([], opts);
check("N: empty range has zero units", empty.totals.units === 0 && empty.services.length === 0 && empty.days.length === 0);

const many = [];
for (let i = 0; i < 90; i += 1) {
  many.push(sale({
    saleId: "n" + i,
    items: [item({ amount: 5 })]
  }));
}
const over80 = api.summarizeServiceSales(many, opts);
check("O: more than 80 closed service tickets still summarize", over80.totals.units === 90 && over80.totals.grossSales === 450);

const noItems = api.summarizeServiceSales([
  sale({ items: [], subtotal: 33 })
], opts);
check("P: a closed ticket with no lines uses subtotal as unspecified service", noItems.services[0].name === "Unspecified service" && noItems.totals.grossSales === 33);

const src = read("public/booking/reports/service-sales-compute.js");
const ui = read("public/booking/reports/service-sales.js");
const shell = read("public/booking/reports/ui.js");
check("compute does not read priceSnapshot", src.indexOf("priceSnapshot") === -1);
check("ui uses range-complete retrieval", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("listForSalon") === -1 && ui.indexOf("listForLocation") === -1 && ui.indexOf("limit: 80") === -1);
check("ui refuses incomplete totals", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1);
check("ui does not call it revenue", ui.indexOf("revenue") === -1 && ui.indexOf("Revenue") === -1);
check("ui names booked value as not this report", ui.indexOf("Booked service value stays in Booking Intelligence") !== -1);
check("reports ui loads service sales modules", shell.indexOf("/booking/reports/service-sales-compute.js") !== -1 && shell.indexOf("/booking/reports/service-sales.js") !== -1);
check("reports ui can paint service sales", shell.indexOf('id === "service-sales"') !== -1 && shell.indexOf("ffBookingReportsServiceSales") !== -1);

if (failed) process.exit(1);
console.log("All Booking service sales checks passed.");
