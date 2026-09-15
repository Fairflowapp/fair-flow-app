/**
 * Week Calendar Print Week. View-only. No OS print-dialog automation.
 * Usage: node scripts/test-booking-calendar-week-print.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function makeClassList(initial) {
  const set = new Set(String(initial || "").split(/\s+/).filter(Boolean));
  return {
    add: function (name) { set.add(name); },
    remove: function (name) { set.delete(name); },
    contains: function (name) { return set.has(name); },
    toString: function () { return Array.from(set).join(" "); }
  };
}

function makeNode(tag, attrs, kids) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    id: attrs && attrs.id || "",
    className: attrs && attrs.class || "",
    attributes: Object.assign({}, attrs || {}),
    children: kids || [],
    parentNode: null,
    style: {},
    innerHTML: "",
    classList: makeClassList(attrs && attrs.class)
  };
  node.setAttribute = function (key, value) {
    this.attributes[key] = String(value);
    if (key === "class") this.className = String(value);
  };
  node.getAttribute = function (key) {
    if (this.attributes[key] == null) return null;
    return String(this.attributes[key]);
  };
  node.removeAttribute = function (key) { delete this.attributes[key]; };
  node.appendChild = function (child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  };
  node.insertBefore = function (child, ref) {
    child.parentNode = this;
    const idx = this.children.indexOf(ref);
    if (idx === -1) this.children.unshift(child);
    else this.children.splice(idx, 0, child);
    return child;
  };
  node.querySelector = function (sel) { return query(this, sel, true); };
  node.querySelectorAll = function (sel) { return queryAll(this, sel); };
  return node;
}

function attrEq(node, name, value) {
  return node.getAttribute && node.getAttribute(name) === value;
}

function matches(node, sel) {
  if (!node || !sel) return false;
  if (sel.charAt(0) === "#") return node.id === sel.slice(1);
  if (sel.charAt(0) === ".") return node.classList && node.classList.contains(sel.slice(1));
  var attr = /^\[([^=\]]+)(?:=\"([^\"]*)\")?\]$/.exec(sel);
  if (attr) {
    if (attr[2] == null) return node.getAttribute(attr[1]) != null;
    return attrEq(node, attr[1], attr[2]);
  }
  if (sel.indexOf(".") !== -1) {
    var parts = sel.split(".");
    return matches(node, "." + parts[1]) && (parts[0] === "" || node.tagName === parts[0].toUpperCase());
  }
  return false;
}

function walk(node, visit) {
  visit(node);
  (node.children || []).forEach(function (child) { walk(child, visit); });
}

function queryAll(node, sel) {
  var out = [];
  walk(node, function (el) {
    if (el !== node && matches(el, sel)) out.push(el);
  });
  if (matches(node, sel)) out.unshift(node);
  return out;
}

function query(node, sel) {
  var all = queryAll(node, sel);
  return all.length ? all[0] : null;
}

const mon = makeNode("div", { class: "ff-cal-col", "data-ff-cal-day": "2026-09-14" });
mon.appendChild(makeNode("button", { class: "ff-cal-card", "data-ff-cal-card": "a1" }));
mon.appendChild(makeNode("div", { class: "ff-cal-off" }));
const tue = makeNode("div", { class: "ff-cal-col", "data-ff-cal-day": "2026-09-15" });
tue.appendChild(makeNode("div", { class: "ff-cal-block", "data-ff-cal-block": "b1" }));
const wed = makeNode("div", { class: "ff-cal-col", "data-ff-cal-day": "2026-09-16" });
wed.appendChild(makeNode("div", { class: "ff-cal-closed" }));
const nowLine = makeNode("div", { class: "ff-cal-now ff-cal-print-hide", "data-ff-cal-now": "" });
const toolbar = makeNode("div", { class: "ff-cal-toolbar ff-cal-print-hide" });
toolbar.appendChild(makeNode("button", { class: "ff-cal-print", "data-ff-cal-act": "print" }));
toolbar.appendChild(makeNode("button", { class: "ff-cal-week-provider", "data-ff-cal-act": "week-pick" }));
toolbar.appendChild(makeNode("button", { class: "ff-cal-filters", "data-ff-cal-act": "filters" }));
const cal = makeNode("div", { class: "ff-cal is-week" });
cal.appendChild(toolbar);
cal.appendChild(mon);
cal.appendChild(tue);
cal.appendChild(wed);
cal.appendChild(nowLine);
const rootNode = makeNode("div", { id: "ffBookingCalendarRoot" });
rootNode.appendChild(cal);
const body = makeNode("body", { class: "" });
body.classList = makeClassList("");

const documentObj = {
  readyState: "complete",
  body: body,
  documentElement: {},
  addEventListener: function () {},
  createElement: function (tag) { return makeNode(tag, {}); },
  getElementById: function (id) { return id === "ffBookingCalendarRoot" ? rootNode : null; },
  querySelector: function (sel) { return query(rootNode, sel) || query(body, sel); },
  querySelectorAll: function (sel) { return queryAll(rootNode, sel); }
};

function load(rel, windowObj, doc) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, doc);
}

const windowObj = {
  addEventListener: function () {},
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  print: function () { windowObj.__printCalls = (windowObj.__printCalls || 0) + 1; },
  __ff_locations: [{ id: "loc-midtown", name: "Midtown" }],
  ffBookingTime: null
};

load("public/booking/calendar-time.js", windowObj, documentObj);
load("public/booking/calendar-state.js", windowObj, documentObj);
load("public/booking/calendar-print.js", windowObj, documentObj);

const st = windowObj.ffBookingCalState;
const printApi = windowObj.ffBookingCalPrint;
const tm = windowObj.ffBookingTime;

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

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen")]);
st.setLocationId("loc-midtown");
st.setSelectedDateKey("2026-09-15");
st.setVisibleProviderIds(["ashley", "nicole"]);

check("Day view still reports Print Day", printApi.canPrintDay() === true && printApi.printButtonLabel() === "Print Day" && printApi.headerMeta().title === "Booking Day Schedule");

st.setView("week");
st.setWeekProviderId("ashley");
st.setWeekAnchorKey("2026-09-16");

check("Week view reports Print Week", printApi.canPrintWeek() === true && printApi.canPrintDay() === false && printApi.printButtonLabel() === "Print Week");

const dayFilter = st.getVisibleProviderIds().join(",");
const weekProvider = st.getWeekProviderId();
const weekStart = st.getWeekStartKey();
const dayDate = st.getSelectedDateKey();

const snap = printApi.printCurrent();
check("Week Print uses selected Week provider", snap.providerIds.join(",") === "ashley" && snap.printScopeId === "ashley" && snap.header.providerName === "Ashley Rivera");
check("Week Print uses active location", snap.locationId === "loc-midtown" && snap.header.locationName === "Midtown");
check("Week Print uses current Monday–Sunday range", snap.weekDateKeys.join(",") === "2026-09-14,2026-09-15,2026-09-16,2026-09-17,2026-09-18,2026-09-19,2026-09-20" && snap.header.weekRange === tm.formatWeekRange("2026-09-16"));
check("Week Print header names Fair Flow Booking Week Schedule", snap.header.brand === "Fair Flow" && snap.header.title === "Booking Week Schedule");
check("Week Print does not mutate Day provider filters", st.getVisibleProviderIds().join(",") === dayFilter);
check("Week Print does not mutate Week provider/range", st.getWeekProviderId() === weekProvider && st.getWeekStartKey() === weekStart && st.getSelectedDateKey() === dayDate);

check("print mode removes current-time line", nowLine.classList.contains("ff-cal-print-hide"));
check("print mode removes toolbar/menus/drag UI", toolbar.classList.contains("ff-cal-print-hide"));
check("appointments remain in printable Week DOM", !!mon.querySelector("[data-ff-cal-card]"));
check("blocks remain in printable Week DOM", !!tue.querySelector("[data-ff-cal-block]"));
check("provider unavailable/closed states remain represented", !!mon.querySelector(".ff-cal-off") && !!wed.querySelector(".ff-cal-closed"));
check("Week print mode does not hide other day columns", cal.getAttribute("data-ff-cal-print-only") == null && cal.getAttribute("data-ff-cal-print-view") === "week");
check("Week print header includes location, provider, and range", String(cal.querySelector("[data-ff-cal-print-header]").innerHTML).indexOf("Midtown") !== -1 && String(cal.querySelector("[data-ff-cal-print-header]").innerHTML).indexOf("Ashley Rivera") !== -1 && String(cal.querySelector("[data-ff-cal-print-header]").innerHTML).indexOf("Sep 14") !== -1);

printApi.exitPrintMode();
check("afterprint cleans Week print state", printApi.isPrintMode() === false && !body.classList.contains("ff-cal-printing") && !cal.getAttribute("data-ff-cal-print-view") && !cal.classList.contains("is-printing"));
check("Week context is unchanged after print", st.getWeekProviderId() === "ashley" && st.getWeekStartKey() === "2026-09-14" && st.getSelectedDateKey() === "2026-09-15" && st.getVisibleProviderIds().join(",") === dayFilter);

st.setView("day");
check("Day Print is restored after leaving Week", printApi.canPrintDay() === true && printApi.headerMeta().title === "Booking Day Schedule");
const daySnap = printApi.printProvider("ashley");
check("Day provider-menu print still scopes one column", daySnap.printScopeId === "ashley" && cal.getAttribute("data-ff-cal-print-only") === "ashley");
printApi.exitPrintMode();

const cssSrc = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
const weekSrc = fs.readFileSync(path.join(root, "public/booking/calendar-week.js"), "utf8");
const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
check("Week toolbar print control is enabled", weekSrc.indexOf("Print Week") !== -1 && !/data-ff-cal-act="print"[^>]*disabled title="Print Day/.test(weekSrc));
check("Week print action is wired", calSrc.indexOf("printCurrent") !== -1);
check("Week print CSS keeps seven day columns", cssSrc.indexOf('data-ff-cal-print-view="week"') !== -1 && cssSrc.indexOf("/ 7)") !== -1);
check("print CSS still hides current-time and chrome", cssSrc.indexOf(".ff-cal-now") !== -1 && cssSrc.indexOf(".ff-cal-toolbar") !== -1 && cssSrc.indexOf(".ff-cal-hold") !== -1);
check("print CSS still uses landscape", cssSrc.indexOf("size: landscape") !== -1);
check("browser print was invoked for Week", windowObj.__printCalls >= 1);

if (failed) {
  console.error(failed + " calendar week-print tests failed.");
  process.exit(1);
}
console.log("All calendar week-print tests passed.");
