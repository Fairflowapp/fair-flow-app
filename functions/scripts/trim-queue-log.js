/**
 * One-time (re-runnable) maintenance: archive + trim an oversized queueState
 * history log. The doc hit ~975KB of Firestore's 1MiB limit, which made the
 * security-rules evaluation fail and EVERY client write get rejected.
 *
 * - Archives the FULL log to salons/{salonId}/queueLogArchive/{docId}_{ts}_{n}
 *   in chunks of 2000 entries (admin write, clients never read it).
 * - Trims the live doc's log to the newest KEEP entries and bumps rev by 1 so
 *   clients pick it up as a genuine remote change.
 *
 * Usage: node functions/scripts/trim-queue-log.js --salonId X --docId Y [--keep 1500]
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
  const argv = process.argv.slice(2);
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const salonId = get("--salonId");
  const docId = get("--docId");
  const keep = Number(get("--keep", "1500")) || 1500;
  if (!salonId || !docId) { console.log("need --salonId and --docId"); process.exit(1); }

  const db = admin.firestore();
  const ref = db.doc(`salons/${salonId}/queueState/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log("doc missing"); process.exit(1); }
  const d = snap.data() || {};
  const log = Array.isArray(d.log) ? d.log : [];
  console.log(`rev=${d.rev} log=${log.length} entries`);
  if (log.length <= keep) { console.log("log already within cap — nothing to do"); process.exit(0); }

  const stamp = Date.now();
  const CHUNK = 2000;
  for (let i = 0, n = 0; i < log.length; i += CHUNK, n++) {
    const chunk = log.slice(i, i + CHUNK);
    const aref = db.doc(`salons/${salonId}/queueLogArchive/${docId}_${stamp}_${n}`);
    await aref.set({
      sourceDoc: docId,
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      fromIndex: i,
      count: chunk.length,
      entries: chunk,
    });
    console.log(`archived chunk ${n}: entries ${i}..${i + chunk.length - 1}`);
  }

  const trimmed = log.slice(-keep);
  const newRev = (typeof d.rev === "number" ? d.rev : 0) + 1;
  await ref.update({
    log: trimmed,
    rev: newRev,
    lastUpdateReason: "history-archive-trim",
    lastUpdatedByUid: "server:maintenance",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`trimmed live doc to ${trimmed.length} entries, rev=${newRev}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
