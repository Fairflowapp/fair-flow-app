/** Stamp locationId on test_salon_001 inventory categories/subcategories (test data only). */
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

const SALON = "test_salon_001";
const LOC = "1XQ0ctEoDn9HYye7nt28"; // "Brickell" location of the test salon

(async () => {
  const db = admin.firestore();
  const cats = await db.collection(`salons/${SALON}/inventoryCategories`).get();
  for (const c of cats.docs) {
    await c.ref.update({ locationId: LOC });
    console.log(`cat ${c.id} (${(c.data() || {}).name}) -> locationId=${LOC}`);
    const subs = await c.ref.collection("inventorySubcategories").get();
    for (const s of subs.docs) {
      await s.ref.update({ locationId: LOC });
      console.log(`  sub ${s.id} (${(s.data() || {}).name}) -> locationId=${LOC}`);
    }
  }
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
