/*
 * READ-ONLY: inspect passwordResetRequests + outbound mail queue for
 * zuanet3@gmail.com (Elizabeth Alvarez). No writes.
 * Usage: node scripts/check-reset-requests.js
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

const EMAIL = "zuanet3@gmail.com";

function fmtTs(v) {
  try { if (v && typeof v.toDate === "function") return v.toDate().toISOString(); } catch (_) {}
  return v == null ? "" : String(v);
}

(async () => {
  console.log("=== passwordResetRequests for", EMAIL, "===");
  try {
    const snap = await db.collection("passwordResetRequests").where("email", "==", EMAIL).get();
    console.log(`count=${snap.size}`);
    snap.forEach((d) => {
      const x = d.data() || {};
      console.log(`  - ${d.id}: createdAt=${fmtTs(x.createdAt)} status=${x.status || ""} error=${x.error || ""} processedAt=${fmtTs(x.processedAt)}`);
      console.log(`    full: ${JSON.stringify(x).slice(0, 400)}`);
    });
  } catch (e) { console.log("query failed:", e.message); }

  console.log("\n=== recent passwordResetRequests (last 15, any email) ===");
  try {
    const snap = await db.collection("passwordResetRequests").orderBy("createdAt", "desc").limit(15).get();
    snap.forEach((d) => {
      const x = d.data() || {};
      console.log(`  - ${d.id}: email=${x.email || ""} createdAt=${fmtTs(x.createdAt)} status=${x.status || ""}`);
    });
  } catch (e) { console.log("query failed:", e.message); }

  console.log("\n=== mail queue docs to", EMAIL, "===");
  for (const coll of ["mail", "emails", "mailQueue"]) {
    try {
      const snap = await db.collection(coll).where("to", "==", EMAIL).limit(10).get();
      if (!snap.empty) {
        console.log(`collection "${coll}": ${snap.size} doc(s)`);
        snap.forEach((d) => {
          const x = d.data() || {};
          const del = x.delivery || {};
          console.log(`  - ${d.id}: subject="${(x.message || {}).subject || ""}" state=${del.state || ""} error=${del.error || ""} startTime=${fmtTs(del.startTime)} endTime=${fmtTs(del.endTime)}`);
        });
      } else {
        console.log(`collection "${coll}": none (by to==string)`);
      }
      // also try array-contains
      const snap2 = await db.collection(coll).where("to", "array-contains", EMAIL).limit(10).get();
      if (!snap2.empty) {
        console.log(`collection "${coll}" (array): ${snap2.size} doc(s)`);
        snap2.forEach((d) => {
          const x = d.data() || {};
          const del = x.delivery || {};
          console.log(`  - ${d.id}: subject="${(x.message || {}).subject || ""}" state=${del.state || ""} error=${JSON.stringify(del.error || "")} startTime=${fmtTs(del.startTime)} endTime=${fmtTs(del.endTime)}`);
        });
      }
    } catch (e) { console.log(`collection "${coll}" query failed:`, e.message); }
  }

  process.exit(0);
})().catch((err) => { console.error("Failed:", err); process.exit(1); });
