/**
 * Backfill small thumbnails for existing Media (contentWorks) uploads.
 *
 * Uploads are full-resolution phone photos (~5 MB, 4032x3024). Painting a grid from
 * the originals costs ~48 MB of RAM each once decoded, which is what made Safari
 * discard the tab. New uploads get a 480px companion thumbnail at upload time; this
 * script creates the same companion for media that already exists.
 *
 * For each image mediaItem without a thumbnail it writes
 * `<storagePath>.thumb.jpg` plus `thumbUrl` / `thumbStoragePath` on the item, and
 * `previewThumbUrl` / `previewThumbStoragePath` on the parent work when the item is
 * the work's preview. Videos are skipped. Re-running is safe (already-done items
 * are skipped).
 *
 * Usage:
 *   node functions/scripts/backfill-media-thumbnails.js --salonId <id> --dry-run
 *   node functions/scripts/backfill-media-thumbnails.js --salonId <id>
 *   node functions/scripts/backfill-media-thumbnails.js --all
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const admin = require("firebase-admin");

const THUMB_PX = 480;
const BUCKET = "fairflowapp-db841.firebasestorage.app";

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
const au = {
  type: "authorized_user",
  client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
  client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
  refresh_token: cfg.tokens.refresh_token,
};
const adcDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
fs.writeFileSync(path.join(adcDir, "adc.json"), JSON.stringify(au));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(adcDir, "adc.json");
admin.initializeApp({
  projectId: "fairflowapp-db841",
  storageBucket: BUCKET,
  credential: admin.credential.applicationDefault(),
});

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const get = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DRY = flag("--dry-run");

function isImagePath(p) {
  return /\.(jpe?g|png|heic|heif|webp)$/i.test(String(p || ""));
}

function downloadUrlFor(objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function makeThumb(bucket, storagePath, workDir) {
  const src = path.join(workDir, "src" + (path.extname(storagePath) || ".jpg"));
  const out = path.join(workDir, "thumb.jpg");
  await bucket.file(storagePath).download({ destination: src });
  execFileSync("/usr/bin/sips", ["-Z", String(THUMB_PX), "-s", "format", "jpeg", src, "--out", out], { stdio: "ignore" });
  const size = fs.statSync(out).size;
  return { out, src, size };
}

async function processSalon(db, bucket, salonId, stats) {
  const works = await db.collection(`salons/${salonId}/contentWorks`).get();
  console.log(`\n=== salon ${salonId}: ${works.size} works`);

  for (const workDoc of works.docs) {
    const work = workDoc.data() || {};
    if (work.status === "deleted") continue;

    const items = await db.collection(`salons/${salonId}/contentWorks/${workDoc.id}/mediaItems`).get();
    for (const itemDoc of items.docs) {
      const item = itemDoc.data() || {};
      const storagePath = String(item.storagePath || "").trim();
      if (!storagePath) { stats.skippedNoPath++; continue; }
      if (String(item.thumbStoragePath || "").trim()) { stats.alreadyDone++; continue; }
      if (!isImagePath(storagePath)) { stats.skippedVideo++; continue; }

      const thumbPath = `${storagePath}.thumb.jpg`;
      if (DRY) {
        console.log(`  [dry] would create ${thumbPath}`);
        stats.created++;
        continue;
      }

      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-thumb-"));
      try {
        const { out, size } = await makeThumb(bucket, storagePath, workDir);
        const token = crypto.randomUUID();
        await bucket.upload(out, {
          destination: thumbPath,
          metadata: {
            contentType: "image/jpeg",
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
        const thumbUrl = downloadUrlFor(thumbPath, token);

        await itemDoc.ref.update({ thumbUrl, thumbStoragePath: thumbPath });
        const isPreview =
          String(work.previewStoragePath || "").trim() === storagePath ||
          Number(item.sortOrder || 0) === 0;
        if (isPreview) {
          await workDoc.ref.update({ previewThumbUrl: thumbUrl, previewThumbStoragePath: thumbPath });
        }

        stats.created++;
        stats.bytes += size;
        console.log(`  ok ${workDoc.id}/${itemDoc.id} -> ${(size / 1024).toFixed(0)} KB${isPreview ? " (preview)" : ""}`);
      } catch (e) {
        stats.failed++;
        console.warn(`  FAIL ${workDoc.id}/${itemDoc.id}: ${e.message}`);
      } finally {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  }
}

(async () => {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const stats = { created: 0, alreadyDone: 0, skippedVideo: 0, skippedNoPath: 0, failed: 0, bytes: 0 };

  let salonIds = [];
  const one = get("--salonId", "");
  if (one) {
    salonIds = [one];
  } else if (flag("--all")) {
    const salons = await db.collection("salons").get();
    salonIds = salons.docs.map((d) => d.id);
  } else {
    console.log("Pass --salonId <id> or --all. Add --dry-run to preview.");
    process.exit(1);
  }

  for (const salonId of salonIds) {
    await processSalon(db, bucket, salonId, stats);
  }

  console.log(`\n${DRY ? "[DRY RUN] " : ""}done:`, stats, `thumb bytes: ${(stats.bytes / 1048576).toFixed(2)} MB`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
