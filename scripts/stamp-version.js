/**
 * Hosting predeploy hook (see firebase.json): stamps a fresh version value
 * into public/version.json on EVERY deploy. Deployed clients poll this file
 * (public/auto-update.js) and reload themselves when it changes — no user is
 * ever asked to refresh manually.
 */
const fs = require("fs");
const path = require("path");

const now = new Date();
const v = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); // YYYYMMDDHHmmss
const out = { v: v, stampedAt: now.toISOString() };
const target = path.join(__dirname, "..", "public", "version.json");
fs.writeFileSync(target, JSON.stringify(out) + "\n");
console.log("[stamp-version] public/version.json -> " + out.v);
