/** READ-ONLY: inspect auto-reset state for a salon — queue + tasks.
 * Shows queueSettings autoReset config, runtime.lastAutoResetDate, current
 * queue/service lengths, lastUpdateReason, and tasks reset stamps.
 * Usage: node functions/scripts/check-auto-reset.js --salonId Zmqs7MrHe4vgscfiCtNF
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
  const salonId = get("--salonId", "Zmqs7MrHe4vgscfiCtNF");
  const db = admin.firestore();

  console.log(`=== salon ${salonId} — queueState docs ===`);
  const qs = await db.collection(`salons/${salonId}/queueState`).get();
  for (const d of qs.docs) {
    const data = d.data() || {};
    const settingsBlob = data.queueSettings || {};
    const bucket = settingsBlob[d.id] || settingsBlob.default || {};
    const autoReset = (bucket.settings && bucket.settings.autoReset) || null;
    const runtime = bucket.runtime || {};
    console.log(`doc=${d.id}`);
    console.log(`  rev=${data.rev} lastUpdateReason=${data.lastUpdateReason} lastUpdatedByUid=${data.lastUpdatedByUid || ""} updatedAt=${fmtTs(data.updatedAt)}`);
    console.log(`  queue=${(data.queue || []).length} service=${(data.service || []).length} log=${(data.log || []).length}`);
    console.log(`  autoReset=${JSON.stringify(autoReset)}`);
    console.log(`  runtime.lastAutoResetDate=${runtime.lastAutoResetDate || "(none)"}`);
    console.log(`  queue names: ${(data.queue || []).map((w) => w && w.name).join(", ")}`);
    console.log(`  service names: ${(data.service || []).map((w) => w && w.name).join(", ")}`);
    const tail = (data.log || []).slice(-6).map((e) => `${e.time || e.ts || "?"} ${e.action || e.type || "?"} ${e.name || ""}`);
    console.log(`  log tail: ${JSON.stringify(tail, null, 0)}`);
    // Also list all settings buckets present (loc ids)
    console.log(`  settings buckets: ${Object.keys(settingsBlob).join(", ") || "(none)"}`);
  }

  console.log(`\n=== tasks reset state ===`);
  const candidates = ["tasksState", "tasks", "taskState"];
  for (const col of candidates) {
    const snap = await db.collection(`salons/${salonId}/${col}`).limit(5).get().catch(() => null);
    if (snap && snap.size) {
      for (const d of snap.docs) {
        const data = d.data() || {};
        const keys = Object.keys(data);
        console.log(`${col}/${d.id}: keys=${keys.slice(0, 15).join(",")}`);
        for (const k of keys) {
          if (/reset/i.test(k)) console.log(`   ${k}=${JSON.stringify(data[k]).slice(0, 200)}`);
        }
        if (data.settings) console.log(`   settings=${JSON.stringify(data.settings).slice(0, 300)}`);
        if (data.runtime) console.log(`   runtime=${JSON.stringify(data.runtime).slice(0, 300)}`);
      }
    } else {
      console.log(`${col}: (empty or missing)`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
