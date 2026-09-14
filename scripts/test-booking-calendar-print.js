/**
 * Day Calendar Print Day. View-only. No OS print-dialog automation.
 * Usage: node scripts/test-booking-calendar-print.js
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

const nowLine = makeNode("div", { class: "ff-cal-now ff-cal-print-hide", "data-ff-cal-now": "" });
const ashleyCol = makeNode("div", { class: "ff-cal-col", "data-ff-cal-emp": "ashley" });
ashleyCol.appendChild(makeNode("button", { class: "ff-cal-card", "data-ff-cal-card": "a1" }));
ashleyCol.appendChild(makeNode("div", { class: "ff-cal-block", "data-ff-cal-block": "b1" }));
const nicoleCol = makeNode("div", { class: "ff-cal-col", "data-ff-cal-emp": "nicole" });
nicoleCol.appendChild(makeNode("button", { class: "ff-cal-card", "data-ff-cal-card": "a2" }));
const ashleyBtn = makeNode("button", { class: "ff-cal-emp-btn", "data-ff-cal-provider": "ashley" });
const nicoleBtn = makeNode("button", { class: "ff-cal-emp-btn", "data-ff-cal-provider": "nicole" });
const toolbar = makeNode("div", { class: "ff-cal-toolbar ff-cal-print-hide" });
toolbar.appendChild(makeNode("button", { class: "ff-cal-print", "data-ff-cal-act": "print" }));
const cal = makeNode("div", { class: "ff-cal" });
cal.appendChild(toolbar);
cal.appendChild(ashleyBtn);
cal.appendChild(nicoleBtn);
cal.appendChild(ashleyCol);
cal.appendChild(nicoleCol);
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

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
st.setLocationId("loc-midtown");
st.setSelectedDateKey("2026-09-16");

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
const menuSrc = fs.readFileSync(path.join(root, "public/booking/calendar-menu.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
const htmlSrc = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

check("Print Day action exists on the toolbar", calSrc.indexOf('data-ff-cal-act="print"') !== -1 && calSrc.indexOf("Print Day") !== -1);
check("Print Day toolbar control is enabled", calSrc.indexOf('data-ff-cal-act="print"') !== -1 && !/data-ff-cal-act="print"[^>]*(disabled|Coming later)/.test(calSrc));
check("provider menu Print day is enabled", /id:\s*"print"[\s\S]*?enabled:\s*true/.test(menuSrc) && menuSrc.indexOf("printProvider") !== -1);
check("print module is wired in index.html", htmlSrc.indexOf("calendar-print.js") !== -1);

const meta = printApi.headerMeta();
check("print uses current Calendar date", meta.dateKey === "2026-09-16" && meta.dateLabel === tm.formatDisplayDate("2026-09-16"));
check("print includes weekday from Calendar date", meta.weekday === "Wednesday");
check("print respects active location", meta.locationId === "loc-midtown" && meta.locationName === "Midtown");
check("print header names Fair Flow Booking Day Schedule", meta.brand === "Fair Flow" && meta.title === "Booking Day Schedule");

check("default print includes all visible providers", printApi.providerIdsToPrint().join(",") === "ashley,nicole,koko");

st.setVisibleProviderIds(["ashley", "koko"]);
check("print respects current provider filter", printApi.providerIdsToPrint().join(",") === "ashley,koko");
const beforeFilter = st.getVisibleProviderIds().join(",");
const currentSnap = printApi.printCurrent();
check("toolbar print uses filtered providers", currentSnap.providerIds.join(",") === "ashley,koko");
check("toolbar print does not change filter state", st.getVisibleProviderIds().join(",") === beforeFilter && st.isProviderFilterActive() === true);
printApi.exitPrintMode();

const beforeOne = st.getVisibleProviderIds().slice();
const providerSnap = printApi.printProvider("ashley");
check("provider-menu print scopes to that provider", providerSnap.printScopeId === "ashley" && providerSnap.providerIds.join(",") === "ashley");
check("provider-menu print does not permanently mutate filter state", st.getVisibleProviderIds().join(",") === beforeOne.join(",") && st.isProviderFilterActive() === true);
check("print-only classes/state activate", printApi.isPrintMode() === true && body.classList.contains("ff-cal-printing") && cal.getAttribute("data-ff-cal-print-only") === "ashley");
check("print-only keep class marks the scoped column", ashleyCol.classList.contains("is-print-keep") && ashleyBtn.classList.contains("is-print-keep"));
check("print-only keep is not applied to other columns", !nicoleCol.classList.contains("is-print-keep"));
check("print header is injected with location and date", !!cal.querySelector("[data-ff-cal-print-header]") && String(cal.querySelector("[data-ff-cal-print-header]").innerHTML).indexOf("Midtown") !== -1 && String(cal.querySelector("[data-ff-cal-print-header]").innerHTML).indexOf("Wednesday") !== -1);

check("current-time line is marked print-hide", nowLine.classList.contains("ff-cal-print-hide"));
check("toolbar is marked print-hide", toolbar.classList.contains("ff-cal-print-hide"));
check("appointments remain in printed Calendar DOM", !!ashleyCol.querySelector("[data-ff-cal-card]") && !!nicoleCol.querySelector("[data-ff-cal-card]"));
check("blocks remain in printed Calendar DOM", !!ashleyCol.querySelector("[data-ff-cal-block]"));

printApi.exitPrintMode();
check("exiting print restores Calendar chrome state", printApi.isPrintMode() === false && !body.classList.contains("ff-cal-printing") && !cal.getAttribute("data-ff-cal-print-only"));
check("filter is still the same after exiting print", st.getVisibleProviderIds().join(",") === "ashley,koko");

check("print CSS hides current-time and action chrome", cssSrc.indexOf(".ff-cal-now") !== -1 && cssSrc.indexOf(".ff-cal-toolbar") !== -1 && cssSrc.indexOf("@media print") !== -1);
check("print CSS uses landscape page", cssSrc.indexOf("size: landscape") !== -1);
check("print CSS distinguishes closed/off/blocked/appointments without color alone", cssSrc.indexOf(".ff-cal-closed") !== -1 && cssSrc.indexOf(".ff-cal-off") !== -1 && cssSrc.indexOf(".ff-cal-block") !== -1 && cssSrc.indexOf("dashed") !== -1);
check("print CSS hides sidebar and menus", cssSrc.indexOf(".ff-booking-sidebar") !== -1 && cssSrc.indexOf(".ff-cal-menu") !== -1);
check("browser print was invoked from the print actions", windowObj.__printCalls >= 2);

const blocksSrc = fs.readFileSync(path.join(root, "public/booking/calendar-blocks.js"), "utf8");
check("block paint still writes into visible provider columns", blocksSrc.indexOf('data-ff-cal-emp') !== -1 && blocksSrc.indexOf("forView(dateKey, locationId)") !== -1);

if (failed) {
  console.error(failed + " calendar print tests failed.");
  process.exit(1);
}
console.log("All calendar print tests passed.");
