/** Dump inventoryCategories (+subcategories, locationId) for two salons. Read-only. */
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

(async () => {
  const db = admin.firestore();
  for (const salonId of ["Zmqs7MrHe4vgscfiCtNF", "test_salon_001"]) {
    console.log(`\n=== salon ${salonId} ===`);
    const salon = await db.doc(`salons/${salonId}`).get();
    const sd = salon.data() || {};
    console.log(`salon fields: locations=${JSON.stringify(sd.locations || null)} activeLocationId=${sd.activeLocationId || ""}`);
    const cats = await db.collection(`salons/${salonId}/inventoryCategories`).get();
    for (const c of cats.docs) {
      const d = c.data() || {};
      console.log(` cat id=${c.id} name=${JSON.stringify(d.name)} locationId=${JSON.stringify(d.locationId ?? null)} order=${d.order ?? ""} keys=${Object.keys(d).join(",")}`);
      const subs = await c.ref.collection("inventorySubcategories").get();
      for (const s of subs.docs) {
        const sd2 = s.data() || {};
        console.log(`   sub id=${s.id} name=${JSON.stringify(sd2.name)} rows=${Array.isArray(sd2.rows) ? sd2.rows.length : "n/a"} keys=${Object.keys(sd2).slice(0, 8).join(",")}`);
      }
    }
    const locs = await db.collection(`salons/${salonId}/locations`).get().catch(() => null);
    if (locs) for (const l of locs.docs) console.log(` location id=${l.id} name=${(l.data() || {}).name}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
