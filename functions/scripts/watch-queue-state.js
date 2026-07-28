/**
 * Read-only: watch a salon's queueState doc(s) live and print every change
 * (rev, lastUpdateReason, lastUpdatedByUid, queue/service names, log tail).
 * Used to diagnose the Available→In Service "jump back" in production.
 *
 * Usage:
 *   node functions/scripts/watch-queue-state.js --find Mileidys
 *   node functions/scripts/watch-queue-state.js --salonId <id> [--seconds 90]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");

const DEFAULT_PROJECT = "fairflowapp-db841";

function loadFirebaseToolsAuthorizedUser() {
  const cfgPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const refreshToken = cfg?.tokens?.refresh_token;
  if (!refreshToken) return null;
  let clientId = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
  let clientSecret = "j9iVZfS8kkCEFUPaAeJV0sAi";
  try {
    const apiJs = [
      "/usr/local/lib/node_modules/firebase-tools/lib/api.js",
      "/opt/homebrew/lib/node_modules/firebase-tools/lib/api.js",
    ].find((p) => fs.existsSync(p));
    if (apiJs) {
      const t = fs.readFileSync(apiJs, "utf8");
      const id = (t.match(/FIREBASE_CLIENT_ID\",\s*\"([^\"]+)/) || [])[1];
      const secret = (t.match(/FIREBASE_CLIENT_SECRET\",\s*\"([^\"]+)/) || [])[1];
      if (id) clientId = id;
      if (secret) clientSecret = secret;
    }
  } catch (_) {}
  return { type: "authorized_user", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken };
}

async function initAdmin(projectId) {
  if (admin.apps.length) return admin.app();
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    await auth.getClient();
    return admin.initializeApp({ projectId });
  } catch (_) {
    const authorizedUser = loadFirebaseToolsAuthorizedUser();
    if (!authorizedUser) throw new Error("No ADC and no firebase-tools login.");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
    const adcPath = path.join(tmpDir, "application_default_credentials.json");
    fs.writeFileSync(adcPath, JSON.stringify(authorizedUser, null, 2));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
    return admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
  }
}

function names(arr) {
  return (Array.isArray(arr) ? arr : []).map((x) => (x && x.name) || "?").join(", ");
}

function fmtTs(v) {
  try {
    if (v && typeof v.toDate === "function") return v.toDate().toISOString();
  } catch (_) {}
  return String(v || "");
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const project = get("--project", DEFAULT_PROJECT);
  const findName = get("--find", "");
  let salonId = get("--salonId", "");
  const seconds = Number(get("--seconds", "90")) || 90;

  await initAdmin(project);
  const db = admin.firestore();

  if (!salonId && findName) {
    console.log(`Searching all salons for queue member "${findName}"...`);
    const salons = await db.collection("salons").listDocuments();
    for (const s of salons) {
      const qs = await s.collection("queueState").get();
      for (const d of qs.docs) {
        const data = d.data() || {};
        const all = JSON.stringify([data.queue || [], data.service || []]);
        if (all.toLowerCase().includes(findName.toLowerCase())) {
          console.log(`  FOUND salon=${s.id} doc=${d.id}`);
          salonId = s.id;
        }
      }
      if (salonId) break;
    }
    if (!salonId) { console.log("Not found."); process.exit(1); }
  }
  if (!salonId) { console.log("Need --salonId or --find"); process.exit(1); }

  const col = db.collection(`salons/${salonId}/queueState`);
  const snap0 = await col.get();
  console.log(`Watching salons/${salonId}/queueState (${snap0.size} docs) for ${seconds}s ...`);

  const diagCol = db.collection(`salons/${salonId}/queueDiag`);
  diagCol.onSnapshot((snap) => {
    snap.docChanges().forEach((ch) => {
      const d = ch.doc.data() || {};
      const ts = new Date().toISOString().slice(11, 23);
      console.log(`\n[${ts}] DIAG ${ch.doc.id} event=${d.event} ok=${d.ok} reason=${d.reason || "-"} pending=${d.pendingWrites} ver=${d.clientVer} uid=${d.uid} doc=${d.docId}`);
      (Array.isArray(d.trace) ? d.trace : []).forEach((t) => console.log(`    ${t}`));
    });
  }, (err) => console.error("diag watch error", err));

  const unsub = col.onSnapshot((snap) => {
    snap.docChanges().forEach((ch) => {
      const d = ch.doc.data() || {};
      const ts = new Date().toISOString().slice(11, 23);
      console.log(`\n[${ts}] ${ch.type.toUpperCase()} doc=${ch.doc.id} rev=${d.rev} reason=${d.lastUpdateReason || "-"} uid=${d.lastUpdatedByUid || "-"} clientVer=${d.clientVer || "-"} updatedAt=${fmtTs(d.updatedAt)}`);
      console.log(`  queue   [${(d.queue || []).length}]: ${names(d.queue)}`);
      console.log(`  service [${(d.service || []).length}]: ${names(d.service)}`);
      const log = Array.isArray(d.log) ? d.log : [];
      log.slice(-3).forEach((e) => {
        console.log(`  log: ${e && e.time} ${e && e.action} (by ${e && e.performedBy}) worker=${e && e.worker}`);
      });
      if (Array.isArray(d.debugTrace) && d.debugTrace.length) {
        console.log("  trace:");
        d.debugTrace.forEach((t) => console.log(`    ${t}`));
      }
    });
  }, (err) => console.error("watch error", err));

  setTimeout(() => { unsub(); console.log("\nDone."); process.exit(0); }, seconds * 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
