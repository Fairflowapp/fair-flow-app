/**
 * READ-ONLY inspection: find a salon by name/owner and dump its queueState
 * doc(s): doc byte size, rev, lastUpdateReason, queue/service members, log
 * length + tail, plus recent queueDiag device reports.
 *
 * Usage: node functions/scripts/inspect-queue-now.js --find "New Nails"
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

function fmtTs(v) {
  try { if (v && typeof v.toDate === "function") return v.toDate().toISOString(); } catch (_) {}
  return String(v || "");
}

(async () => {
  const argv = process.argv.slice(2);
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const find = (get("--find", "") || "").toLowerCase();
  let salonId = get("--salonId", "");

  const db = admin.firestore();

  if (!salonId) {
    const salons = await db.collection("salons").get();
    console.log(`Scanning ${salons.size} salons for "${find}"...`);
    for (const s of salons.docs) {
      const d = s.data() || {};
      const hay = JSON.stringify({ name: d.name, salonName: d.salonName, businessName: d.businessName, ownerName: d.ownerName, ownerEmail: d.ownerEmail }).toLowerCase();
      if (hay.includes(find)) {
        console.log(`  MATCH salon=${s.id} name=${d.name || d.salonName || d.businessName || "?"} owner=${d.ownerName || "?"} email=${d.ownerEmail || "?"}`);
        if (!salonId) salonId = s.id;
      }
    }
    if (!salonId) { console.log("No salon matched."); process.exit(1); }
  }

  console.log(`\n=== salon ${salonId} ===`);
  const qs = await db.collection(`salons/${salonId}/queueState`).get();
  console.log(`queueState docs: ${qs.size}`);
  for (const docSnap of qs.docs) {
    const d = docSnap.data() || {};
    const bytes = Buffer.byteLength(JSON.stringify(d), "utf8");
    const q = Array.isArray(d.queue) ? d.queue : [];
    const sv = Array.isArray(d.service) ? d.service : [];
    const log = Array.isArray(d.log) ? d.log : [];
    console.log(`\n--- doc=${docSnap.id} ---`);
    console.log(`approx size: ${(bytes / 1024).toFixed(1)} KB`);
    console.log(`rev=${d.rev} lastUpdateReason=${d.lastUpdateReason || "-"} clientVer=${d.clientVer || "-"}`);
    console.log(`lastUpdatedByUid=${d.lastUpdatedByUid || "-"} updatedAt=${fmtTs(d.updatedAt)}`);
    console.log(`queue [${q.length}]: ${q.map((x) => (x && x.name) || "?").join(", ")}`);
    console.log(`service [${sv.length}]: ${sv.map((x) => (x && x.name) || "?").join(", ")}`);
    console.log(`log entries: ${log.length}`);
    log.slice(-12).forEach((e) => {
      console.log(`  log: ts=${e && e.ts} time=${e && e.time} action=${e && e.action} worker=${e && e.worker} by=${e && e.performedBy}`);
    });
    if (Array.isArray(d.debugTrace) && d.debugTrace.length) {
      console.log("  debugTrace (from last writer):");
      d.debugTrace.forEach((t) => console.log(`    ${t}`));
    }
  }

  const diag = await db.collection(`salons/${salonId}/queueDiag`).get();
  console.log(`\nqueueDiag docs: ${diag.size}`);
  const rows = diag.docs
    .map((x) => ({ id: x.id, d: x.data() || {} }))
    .sort((a, b) => (fmtTs(a.d.updatedAt) < fmtTs(b.d.updatedAt) ? 1 : -1))
    .slice(0, 8);
  for (const { id, d } of rows) {
    console.log(`\n--- diag device=${id} updatedAt=${fmtTs(d.updatedAt)} ---`);
    console.log(`event=${d.event} ok=${d.ok} reason=${d.reason || "-"} pending=${d.pendingWrites} ver=${d.clientVer} uid=${d.uid} doc=${d.docId}`);
    (Array.isArray(d.trace) ? d.trace : []).slice(-15).forEach((t) => console.log(`    ${t}`));
  }
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
