/**
 * Client Profile V1 static checks. No Firestore downloads.
 * Usage: node scripts/test-booking-client-profile.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function check(name, cond) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name);
  }
}

function load(rel, windowObj) {
  new Function("window", read(rel))(windowObj);
}

const windowObj = {};
load("public/booking/clients/profile-sales.js", windowObj);
load("public/booking/clients/profile-memberships.js", windowObj);
load("public/booking/clients/profile-payments.js", windowObj);
const sales = windowObj.ffBookingClientProfileSales;
const mems = windowObj.ffBookingClientProfileMemberships;
const pays = windowObj.ffBookingClientProfilePayments;

const profile = read("public/booking/clients/profile.js");
const css = read("public/booking/clients/profile.css");
const appts = read("public/booking/clients/profile-appointments.js");
const data = read("public/booking/appointments/data.js");
const ui = read("public/booking/clients/ui.js");
const drawer = read("public/booking/clients/drawer.js");
const indexes = read("firestore.indexes.json");

check("tabs are sales appointments memberships payments notes", sales.TABS.join(",") === "sales,appointments,memberships,payments,notes");
check("payments is not named wallet", pays.EMPTY_COPY.indexOf("Wallet") === -1 && profile.indexOf(">Wallet<") === -1);
check("payments empty is not a fake card list", pays.emptyHtml().indexOf("Visa") === -1 && pays.render(null).indexOf("$0.00") === -1);
check("memberships empty copy is a placeholder", mems.EMPTY_COPY.indexOf("Memberships") !== -1);
check("memberships empty is not a fake plan", mems.emptyHtml().indexOf("remaining") === -1 && mems.render(null).indexOf("Neo Massage") === -1);
check("default tab is sales", sales.DEFAULT_TAB === "sales");
check("sales empty copy mentions checkout", sales.EMPTY_COPY.indexOf("checkout") !== -1);
check("sales empty is not an appointment list", sales.emptyHtml().indexOf("Upcoming") === -1 && sales.emptyHtml().indexOf("ff-cli-appt") === -1);
check("sales render does not invent orders", sales.render(null).indexOf("Sale #") === -1);
check("sales list can show a real ticket", sales.listHtml([{ saleNumber: 12, total: 41, status: "closed" }]).indexOf("Sale #12") !== -1);
check("profile opens on sales", profile.includes('data-ff-clip-tab="sales">Sales') && profile.includes("tab = defaultTab()"));
check("profile has a memberships tab", profile.indexOf('data-ff-clip-tab="memberships">Memberships') !== -1);
check("profile has a payments tab", profile.indexOf('data-ff-clip-tab="payments">Payments') !== -1);
check("profile has no overview tab", profile.indexOf('data-ff-clip-tab="overview"') === -1);
check("hidden attribute wins over flex form", css.indexOf(".ff-clip-drawer [hidden]") !== -1);
check("edit mode hides tabs", css.indexOf(".ff-clip-drawer.is-editing .ff-clip-tabs") !== -1);
check("edit has optional sections", profile.indexOf("Additional details") !== -1 && profile.indexOf("Address") !== -1 && profile.indexOf("Messaging preferences") !== -1);
check("conversations button is in the header", profile.indexOf('data-ff-clip="conversations"') !== -1);
check("conversations do not invent a chat inbox", profile.indexOf("sms:") !== -1 && profile.indexOf("mailto:") !== -1);
check("profile opens by getClientById", profile.includes("api.getClientById(id)"));
check("profile saves with updateClient", profile.includes("api.updateClient(clientId, editValues())"));
check("profile does not write Firestore", !profile.includes("addDoc") && !profile.includes("updateDoc"));
check("appointments tab uses getClientAppointments", appts.includes("api.getClientAppointments(id"));
check("appointments tab does not query Firestore", !appts.includes("getDocs") && !appts.includes("collection("));
check("repository query is clientId + startAt", data.includes('where("clientId", "==", id)') && data.includes("orderBy(\"startAt\""));
check("upcoming/past bounded to 20", data.includes("CLIENT_HISTORY_LIMIT = 20"));
check("no salon-wide download in getClientAppointments", data.includes("limit(cap)"));
check("UI opens profile by clientId", ui.includes("ffBookingClientProfile.open"));
check("drawer add still uses createClient", drawer.includes("api.createClient(values())"));
check("indexes include clientId + startAt", indexes.includes('"fieldPath": "clientId"') && indexes.includes('"fieldPath": "startAt"'));
check("status labels do not write status", appts.includes("Checked In") && appts.includes("No Show") && !appts.includes("updateAppointment"));
check("AH multi-service summary uses plus", appts.includes('names.join(" + ")'));
const clientsData = read("public/booking/clients/data.js");
const rules = read("storage.rules");
check("edit can take or upload a client photo", profile.indexOf("Take photo") !== -1 && profile.indexOf("Upload photo") !== -1 && profile.indexOf("getUserMedia") !== -1 && profile.indexOf("ff-clip-sr-file") !== -1);
check("profile photo goes through the client repository", profile.indexOf("uploadClientPhoto") !== -1 && !profile.includes("uploadBytes"));
check("client photos live under the salon", clientsData.indexOf("salons/${salonId}/clients/${id}/avatar") !== -1);
check("storage allows client profile photos", rules.indexOf("match /salons/{salonId}/clients/{clientId}/{fileName}") !== -1);

if (failed) process.exit(1);
console.log("All Client Profile static checks passed.");
