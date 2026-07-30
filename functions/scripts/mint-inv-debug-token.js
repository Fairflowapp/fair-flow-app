/**
 * Debug helper: locate the salon whose Inventory has an "OPI" category,
 * pick a member there (prefer the owner), and mint a Firebase custom token
 * so a Playwright session can reproduce the mobile Inventory freeze.
 *
 * Usage: node functions/scripts/mint-inv-debug-token.js
 * Prints: salonId, category names, chosen uid, and the custom token.
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
admin.initializeApp({
  projectId: "fairflowapp-db841",
  credential: admin.credential.applicationDefault(),
  // authorized_user creds can't sign JWTs locally; delegate to the App Engine
  // default SA via IAM signBlob.
  serviceAccountId: "fairflowapp-db841@appspot.gserviceaccount.com",
});

(async () => {
  const db = admin.firestore();
  const cats = await db.collectionGroup("inventoryCategories").get();
  const bySalon = new Map();
  for (const c of cats.docs) {
    const salonId = c.ref.parent.parent.id;
    const name = String((c.data() || {}).name || "");
    if (!bySalon.has(salonId)) bySalon.set(salonId, []);
    bySalon.get(salonId).push(name);
  }
  let target = null;
  for (const [salonId, names] of bySalon) {
    if (names.some((n) => n.toLowerCase().includes("opi") || n.toLowerCase().includes("sam's club"))) {
      target = { salonId, names };
      break;
    }
  }
  if (!target) {
    console.log("No salon with an OPI category found. Salons with inventory:");
    for (const [salonId, names] of bySalon) console.log(` ${salonId}: ${names.join(", ")}`);
    process.exit(1);
  }
  console.log(`salon=${target.salonId}`);
  console.log(`categories=${target.names.join(" | ")}`);

  const members = await db.collection(`salons/${target.salonId}/members`).get();
  let chosen = null;
  for (const m of members.docs) {
    const d = m.data() || {};
    const role = String(d.role || "").toLowerCase();
    console.log(` member uid=${m.id} role=${role} name=${d.name || d.displayName || "?"}`);
    const rank = { admin: 3, manager: 2 }[role] || 1;
    const curRank = chosen ? ({ admin: 3, manager: 2 }[chosen.role] || 1) : 0;
    if (rank > curRank) chosen = { uid: m.id, role, name: d.name || d.displayName || "?" };
  }
  if (!chosen) { console.log("No members found"); process.exit(1); }
  console.log(`chosen uid=${chosen.uid} role=${chosen.role} name=${chosen.name}`);
  const token = await admin.auth().createCustomToken(chosen.uid);
  fs.writeFileSync(path.join(__dirname, ".inv-debug-token.txt"), token);
  console.log("token written to functions/scripts/.inv-debug-token.txt");
})().catch((e) => { console.error(e); process.exit(1); });
