/**
 * Clients UI helpers — no Firestore, no collection load.
 * Usage: node scripts/test-booking-clients-ui.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public/booking/clients/ui.js"), "utf8");
const windowObj = { ffBookingTime: null, document: undefined };
new Function("window", "document", src)(windowObj, undefined);
const ui = windowObj.ffBookingClientsUi;
if (!ui) {
  console.error("Clients UI helpers did not load.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("initials JM", ui.initials({ firstName: "Jessica", lastName: "Miller" }) === "JM");
check("dash empty phone", ui.dash("") === "—");
check("dash keeps phone", ui.dash("(305) 555-1212") === "(305) 555-1212");
check("updated missing is dash", ui.formatUpdated(null) === "—");
check("updated from seconds", ui.formatUpdated({ seconds: Date.UTC(2026, 7, 22, 16, 0, 0) / 1000 }) === "Aug 22, 2026");
check("refresh exists", typeof ui.refresh === "function");
check("does not expose a load-all helper", ui.loadAll == null && ui.listAll == null);

const dataSrc = fs.readFileSync(path.join(root, "public/booking/clients/data.js"), "utf8");
check("repository still owns searchClients", dataSrc.includes("async function searchClients"));
check("repository still owns createClient", dataSrc.includes("async function createClient"));
check("repository still owns updateClient", dataSrc.includes("async function updateClient"));

const uiSrc = fs.readFileSync(path.join(root, "public/booking/clients/ui.js"), "utf8");
check("UI search goes through searchClients", uiSrc.includes("api.searchClients(q)"));
check("UI never queries collection group", !uiSrc.includes("getDocs") && !uiSrc.includes("collection("));

const drawerSrc = fs.readFileSync(path.join(root, "public/booking/clients/drawer.js"), "utf8");
check("drawer create uses repository", drawerSrc.includes("api.createClient(values())"));
check("drawer update uses repository", drawerSrc.includes("api.updateClient(clientId, values())"));
check("drawer does not write Firestore itself", !drawerSrc.includes("addDoc") && !drawerSrc.includes("updateDoc"));

if (failed) process.exit(1);
console.log("All Clients UI helper tests passed.");
