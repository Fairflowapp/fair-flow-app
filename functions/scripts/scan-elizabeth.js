/*
 * READ-ONLY: scan every salon's staff for names matching Elizabeth / Alan / Morley,
 * and list locations to find "New Orleans". No writes.
 * Usage: node scripts/scan-elizabeth.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
const au = { type: "authorized_user", client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: cfg.tokens.refresh_token };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
fs.writeFileSync(path.join(tmp, "adc.json"), JSON.stringify(au));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "adc.json");

admin.initializeApp({ projectId: "fairflowapp-db841", credential: admin.credential.applicationDefault() });
const db = admin.firestore();

(async () => {
  const salonsSnap = await db.collection("salons").get();
  for (const salonDoc of salonsSnap.docs) {
    const salonId = salonDoc.id;
    const salonName = (salonDoc.data() || {}).name || "";

    const [staffSnap, locSnap] = await Promise.all([
      db.collection(`salons/${salonId}/staff`).get().catch(() => null),
      db.collection(`salons/${salonId}/locations`).get().catch(() => null),
    ]);

    const staffHits = [];
    if (staffSnap) {
      staffSnap.forEach((d) => {
        const s = d.data() || {};
        const name = String(s.name || s.displayName || "").toLowerCase();
        const email = String(s.email || "").toLowerCase();
        if (/(eliz|alan|morl)/.test(name) || /(eliz|alan|morl)/.test(email)) {
          staffHits.push({ id: d.id, name: s.name || s.displayName || "", email: s.email || "", role: s.role || "", status: s.status || "", uid: s.uid || s.authUid || "" });
        }
      });
    }

    const locHits = [];
    if (locSnap) {
      locSnap.forEach((d) => {
        const l = d.data() || {};
        const hay = JSON.stringify(l).toLowerCase();
        if (hay.includes("orlean") || hay.includes("morl") || hay.includes("alan")) {
          locHits.push({ id: d.id, name: l.name || "", address: l.address || l.city || "" });
        }
      });
    }

    if (staffHits.length || locHits.length) {
      console.log(`\n=== Salon ${salonId} "${salonName}" ===`);
      staffHits.forEach((h) => console.log(`  STAFF: ${h.id} | name="${h.name}" email="${h.email}" role="${h.role}" status="${h.status}" uid="${h.uid}"`));
      locHits.forEach((h) => console.log(`  LOCATION: ${h.id} | name="${h.name}" address="${h.address}"`));
    }
  }
  console.log("\nScan complete.");
  process.exit(0);
})().catch((err) => { console.error("Failed:", err); process.exit(1); });
