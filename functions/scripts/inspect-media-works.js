/**
 * READ-ONLY: dump Media contentWorks for a salon — previewMediaUrl / previewStoragePath
 * presence and the mediaItems subcollection (count + mediaUrl / storagePath per item).
 *
 * Usage:
 *   node functions/scripts/inspect-media-works.js --find "allen"
 *   node functions/scripts/inspect-media-works.js --salonId <id> [--limit 8]
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

function kind(v) {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "EMPTY";
  if (/^https?:\/\//i.test(s)) return "https";
  return "other:" + s.slice(0, 40);
}

(async () => {
  const argv = process.argv.slice(2);
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const find = (get("--find", "") || "").toLowerCase();
  const limit = Number(get("--limit", "8"));
  let salonId = get("--salonId", "");

  const db = admin.firestore();

  if (!salonId) {
    const salons = await db.collection("salons").get();
    console.log(`Scanning ${salons.size} salons for "${find}"...`);
    for (const s of salons.docs) {
      const d = s.data() || {};
      const hay = JSON.stringify({
        name: d.name, salonName: d.salonName, businessName: d.businessName,
        ownerName: d.ownerName, ownerEmail: d.ownerEmail,
      }).toLowerCase();
      if (hay.includes(find)) {
        console.log(`  MATCH salon=${s.id} name=${d.name || d.salonName || d.businessName || "?"} owner=${d.ownerName || "?"} email=${d.ownerEmail || "?"}`);
        if (!salonId) salonId = s.id;
      }
    }
  }
  if (!salonId) {
    console.log("No salon matched. Pass --salonId.");
    process.exit(0);
  }

  console.log(`\n=== salon ${salonId} ===`);
  const works = await db.collection(`salons/${salonId}/contentWorks`).get();
  console.log(`contentWorks total: ${works.size}`);

  let withPreview = 0;
  let withStoragePath = 0;
  let withNeither = 0;
  const statuses = {};
  for (const w of works.docs) {
    const d = w.data() || {};
    statuses[d.status || "(none)"] = (statuses[d.status || "(none)"] || 0) + 1;
    const hasPre = /^https?:\/\//i.test(String(d.previewMediaUrl || "").trim());
    const hasPath = String(d.previewStoragePath || "").trim() !== "";
    if (hasPre) withPreview++;
    if (hasPath) withStoragePath++;
    if (!hasPre && !hasPath) withNeither++;
  }
  console.log("status counts:", statuses);
  console.log(`previewMediaUrl https: ${withPreview}/${works.size}`);
  console.log(`previewStoragePath set: ${withStoragePath}/${works.size}`);
  console.log(`neither preview field: ${withNeither}/${works.size}`);

  const sample = works.docs
    .filter((w) => (w.data() || {}).status !== "deleted")
    .sort((a, b) => {
      const ta = (a.data() || {}).createdAt;
      const tb = (b.data() || {}).createdAt;
      const ma = ta && ta.toMillis ? ta.toMillis() : 0;
      const mb = tb && tb.toMillis ? tb.toMillis() : 0;
      return mb - ma;
    })
    .slice(0, limit);

  for (const w of sample) {
    const d = w.data() || {};
    console.log(`\n--- work ${w.id}`);
    console.log(`    staffName=${d.staffName || "?"} categories=${JSON.stringify(d.categoryNames || d.categoryName || d.serviceType || null)} status=${d.status}`);
    console.log(`    locationId=${d.locationId === undefined ? "(missing)" : JSON.stringify(d.locationId)} salonId=${d.salonId || "(missing)"}`);
    console.log(`    previewMediaUrl=${kind(d.previewMediaUrl)} previewStoragePath=${String(d.previewStoragePath || "") ? "set" : "EMPTY"}`);
    const items = await db.collection(`salons/${salonId}/contentWorks/${w.id}/mediaItems`).get();
    console.log(`    mediaItems: ${items.size}`);
    items.docs.forEach((m, i) => {
      const md = m.data() || {};
      console.log(`      [${i}] id=${m.id} type=${md.mediaType || "?"} mediaUrl=${kind(md.mediaUrl)} storagePath=${String(md.storagePath || "") ? "set" : "EMPTY"} sortOrder=${md.sortOrder}`);
    });
  }

  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
