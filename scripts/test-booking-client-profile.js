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

const profile = read("public/booking/clients/profile.js");
const appts = read("public/booking/clients/profile-appointments.js");
const data = read("public/booking/appointments/data.js");
const ui = read("public/booking/clients/ui.js");
const drawer = read("public/booking/clients/drawer.js");
const indexes = read("firestore.indexes.json");

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

if (failed) process.exit(1);
console.log("All Client Profile static checks passed.");
