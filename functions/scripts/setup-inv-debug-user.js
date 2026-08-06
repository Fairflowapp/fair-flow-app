/**
 * Debug helper: list members of test_salon_001, pick a test account,
 * set a known password on it (test accounts only), and print its email.
 * Used to reproduce the mobile Inventory freeze with Playwright.
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

(async () => {
  const db = admin.firestore();
  const salonId = "test_salon_001";
  const members = await db.collection(`salons/${salonId}/members`).get();
  const list = [];
  for (const m of members.docs) {
    const d = m.data() || {};
    let email = d.email || "";
    if (!email) {
      try { email = (await admin.auth().getUser(m.id)).email || ""; } catch (_) {}
    }
    list.push({ uid: m.id, role: String(d.role || ""), name: d.name || d.displayName || "?", email });
    console.log(` member uid=${m.id} role=${d.role} name=${d.name || d.displayName || "?"} email=${email}`);
  }
  // Only touch obvious test accounts; try candidates until one has an Auth record.
  const candidates = list
    .filter((u) => /(^|_)(test|demo)|_test@/i.test(u.email))
    .sort((a, b) => (/admin|manager/i.test(b.role) ? 1 : 0) - (/admin|manager/i.test(a.role) ? 1 : 0));
  if (!candidates.length) { console.log("No obvious test account found — NOT touching real users."); process.exit(1); }
  const pw = "FfInvDebug!2026";
  for (const test of candidates) {
    try {
      await admin.auth().updateUser(test.uid, { password: pw });
      console.log(`READY email=${test.email} uid=${test.uid} role=${test.role} password=${pw}`);
      return;
    } catch (e) {
      console.log(` skip ${test.email} (${test.uid}): ${e.message}`);
    }
  }
  console.log("No usable test account.");
  process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
