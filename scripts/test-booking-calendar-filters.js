/**
 * Day Calendar provider filters. View-only. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-filters.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, {
    readyState: "complete",
    documentElement: {},
    body: {},
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  });
}

const windowObj = {
  addEventListener: function () {},
  ffBookingTime: {
    zonedMinutes: function (date) {
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    }
  }
};

load("public/booking/calendar-state.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/calendar-filters.js", windowObj);

const st = windowObj.ffBookingCalState;
const blocks = windowObj.ffBookingCalBlocks;
const cards = windowObj.ffBookingCalAppointments;
const layout = windowObj.ffBookingCalLayout;
const filters = windowObj.ffBookingCalFilters;
const data = windowObj.ffBookingCalData;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function emp(id, name) {
  return { id: id, firstName: name, displayName: name, name: name };
}

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);

check("default shows all providers", st.getVisibleEmployees().length === 3 && st.isProviderFilterActive() === false);
check("default visible ids are empty meaning all", st.getVisibleProviderIds().length === 0);

st.setVisibleProviderIds(["ashley"]);
check("filtering to one provider", st.getVisibleEmployees().map(function (row) { return row.id; }).join(",") === "ashley");
check("one-provider filter is active", st.isProviderFilterActive() === true);
check("single filter also sets focus", st.getFocusProviderId() === "ashley");

st.setVisibleProviderIds(["ashley", "koko"]);
check("filtering to multiple providers", st.getVisibleEmployees().map(function (row) { return row.id; }).join(",") === "ashley,koko");
check("multi filter does not keep a single focus id", st.getFocusProviderId() === "");

st.clearVisibleProviders();
check("restoring All providers", st.getVisibleEmployees().length === 3 && st.isProviderFilterActive() === false);

st.setVisibleProviderIds(["ashley", "nicole", "koko"]);
check("selecting every provider collapses to All", st.isProviderFilterActive() === false && st.getVisibleEmployees().length === 3);

function utc(h, m) {
  return new Date(Date.UTC(2026, 11, 17, h, m, 0));
}
const apptCards = cards.cardsFrom([{
  appointmentId: "a1",
  status: "scheduled",
  clientSnapshot: { displayName: "Jenny" },
  serviceLines: [{
    lineId: "l1",
    providerId: "nicole",
    serviceNameSnapshot: "Gel",
    startAt: utc(15, 0),
    endAt: utc(16, 0),
    durationMinutes: 60
  }]
}]);
st.setVisibleProviderIds(["ashley"]);
check("appointment data is untouched when Nicole is hidden", apptCards[0].providerId === "nicole" && apptCards[0].clientName === "Jenny");
check("hidden provider has no visible column", st.getVisibleEmployees().every(function (row) { return row.id !== "nicole"; }));

blocks.setAll([{
  providerId: "nicole",
  locationId: "loc1",
  dateKey: "2026-12-17",
  startMin: 12 * 60,
  endMin: 13 * 60,
  reason: "lunch"
}]);
check("block data remains for a hidden provider", blocks.forProvider("2026-12-17", "loc1", "nicole").length === 1);
st.clearVisibleProviders();
check("restoring All providers shows Nicole again", st.getVisibleEmployees().some(function (row) { return row.id === "nicole"; }));
check("Nicole's block is still there after restore", blocks.forProvider("2026-12-17", "loc1", "nicole").length === 1);

st.setVisibleProviderIds(["ashley"]);
st.setEmployees([emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
check("location change drops stale Ashley filter", st.isProviderFilterActive() === false);
check("new location only lists eligible providers", st.getVisibleEmployees().map(function (row) { return row.id; }).join(",") === "nicole,koko");

st.setVisibleProviderIds(["nicole"]);
st.setEmployees([emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
check("kept filter still valid after location rebuild", st.getVisibleEmployees().map(function (row) { return row.id; }).join(",") === "nicole");

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
st.setVisibleProviderIds(["ashley", "koko"]);
const visible = st.getVisibleEmployees();
const hitHidden = layout.hitTest(144 + 10, 80, {
  employees: visible,
  axis: { startMin: 8 * 60, endMin: 19 * 60 },
  dateKey: "2026-12-17",
  columnWidth: 144
});
check("hidden Nicole is not a drag target in the visible column list", !hitHidden || hitHidden.providerId !== "nicole");
const hitAshley = layout.hitTest(10, 80, {
  employees: visible,
  axis: { startMin: 8 * 60, endMin: 19 * 60 },
  dateKey: "2026-12-17",
  columnWidth: 144
});
check("visible Ashley remains a drag target", !!(hitAshley && hitAshley.providerId === "ashley"));

st.setFocusProviderId("koko");
check("provider-menu focus reuses the same view-only filter", st.getVisibleProviderIds().join(",") === "koko" && st.isProviderFilterActive() === true);
st.clearFocusProvider();
check("All providers from the menu clears the filter", st.isProviderFilterActive() === false);

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen")]);
filters.toggleProvider("nicole");
check("unchecking one provider from All leaves the other visible", st.getVisibleEmployees().map(function (row) { return row.id; }).join(",") === "ashley");
filters.showAll();
check("All providers action restores both", st.getVisibleEmployees().length === 2 && st.isProviderFilterActive() === false);

check("filter state is in-memory only", fs.readFileSync(path.join(root, "public/booking/calendar-state.js"), "utf8").indexOf("localStorage") === -1);
check("filters button is no longer disabled coming later", fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8").indexOf("Coming later") === -1 || fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8").indexOf('data-ff-cal-act="filters"') !== -1);

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
check("toolbar uses the live Filters control", calSrc.indexOf('data-ff-cal-act="filters"') !== -1 && calSrc.indexOf("ff-cal-filters") !== -1);
check("paint still uses visible employees only", calSrc.indexOf("getVisibleEmployees") !== -1);

if (failed) {
  console.error(failed + " calendar filter tests failed.");
  process.exit(1);
}
console.log("All calendar filter tests passed.");
