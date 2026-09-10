/**
 * Phase 1 (read-only): find duplicate inboxItems from the technician
 * double-submit bug (same creator + type + content, created within a few minutes).
 *
 * Usage:
 *   node functions/scripts/find-inbox-duplicate-requests.js
 *   node functions/scripts/find-inbox-duplicate-requests.js --project fair-flow-staging
 *   node functions/scripts/find-inbox-duplicate-requests.js --salonId Zmqs7MrHe4vgscfiCtNF
 *   node functions/scripts/find-inbox-duplicate-requests.js --windowMinutes 5
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
 * Default date window: 2026-07-20 .. 2026-07-21 (America/New_York calendar days).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");

const DEFAULT_PROJECT = "fairflowapp-db841";
const DEFAULT_WINDOW_MINUTES = 5;
/** Inclusive calendar days in America/New_York */
const DEFAULT_FROM_YMD = "2026-07-20";
const DEFAULT_TO_YMD = "2026-07-21";

/** Prefer ADC; fall back to firebase-tools login refresh token (same as CLI). */
function loadFirebaseToolsAuthorizedUser() {
  const cfgPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const refreshToken = cfg?.tokens?.refresh_token;
  if (!refreshToken) return null;
  let clientId =
    "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
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
  return {
    type: "authorized_user",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  };
}

async function initAdmin(projectId) {
  if (admin.apps.length) return admin.app();
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    await auth.getClient();
    return admin.initializeApp({ projectId });
  } catch (_) {
    const authorizedUser = loadFirebaseToolsAuthorizedUser();
    if (!authorizedUser) {
      throw new Error(
        "No ADC and no firebase-tools login. Run: gcloud auth application-default login  OR  firebase login"
      );
    }
    // Firestore Admin requires ADC/cert — materialize firebase-tools login as a temp ADC file.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
    const adcPath = path.join(tmpDir, "application_default_credentials.json");
    fs.writeFileSync(adcPath, JSON.stringify(authorizedUser, null, 2));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
    console.warn("[find-inbox-dupes] Using firebase-tools login via temporary ADC file.");
    return admin.initializeApp({
      projectId,
      credential: admin.credential.applicationDefault(),
    });
  }
}

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    return fallback;
  };
  return {
    project: get("--project", DEFAULT_PROJECT),
    salonId: get("--salonId", "") || "",
    windowMinutes: Math.max(1, Number(get("--windowMinutes", String(DEFAULT_WINDOW_MINUTES))) || DEFAULT_WINDOW_MINUTES),
    fromYmd: get("--from", DEFAULT_FROM_YMD),
    toYmd: get("--to", DEFAULT_TO_YMD),
  };
}

/** Start of YMD and end of YMD in America/New_York → UTC Date bounds. */
function etDayBounds(fromYmd, toYmd) {
  // Use explicit offset approximation via Intl: format a UTC instant as ET parts is awkward;
  // construct Date from `YYYY-MM-DDT00:00:00` interpreted in ET via temporal-like trick:
  // America/New_York on these July dates is EDT (UTC-4).
  const start = new Date(`${fromYmd}T00:00:00-04:00`);
  const end = new Date(`${toYmd}T23:59:59.999-04:00`);
  return { start, end };
}

function tsToDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  if (v instanceof Date) return v;
  return null;
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Content fingerprint: type-aware summary of data payload (items/title/etc). */
function contentFingerprint(type, data) {
  const d = data && typeof data === "object" ? data : {};
  const t = String(type || "").trim();

  if (t === "supplies") {
    const items = Array.isArray(d.items)
      ? d.items.map((it) => ({
          categoryId: it?.categoryId ?? "",
          subcategoryId: it?.subcategoryId ?? "",
          itemId: it?.itemId ?? it?.id ?? "",
          name: it?.name ?? it?.itemName ?? "",
          quantity: it?.quantity ?? it?.qty ?? "",
          unit: it?.unit ?? "",
          variant: it?.variant ?? it?.groupName ?? "",
        }))
      : [];
    return stableStringify({ items, urgency: d.urgency ?? "", note: d.note ?? "" });
  }

  // Common title-like fields across request types
  const title =
    d.subject ??
    d.title ??
    d.documentType ??
    d.note ??
    d.details ??
    "";
  // Prefer a compact stable slice of data (exclude volatile blobs if any)
  const slim = { ...d };
  delete slim.fileUrl;
  delete slim.downloadUrl;
  delete slim.storagePath;
  return stableStringify({ title: String(title), data: slim });
}

function contentPreview(type, data) {
  const d = data && typeof data === "object" ? data : {};
  const t = String(type || "").trim();
  if (t === "supplies") {
    const n = Array.isArray(d.items) ? d.items.length : 0;
    const names = Array.isArray(d.items)
      ? d.items
          .slice(0, 3)
          .map((it) => it?.name || it?.itemName || it?.itemId || "?")
          .join(", ")
      : "";
    return `supplies items=${n}${names ? ` [${names}]` : ""}${d.urgency ? ` urgency=${d.urgency}` : ""}`;
  }
  const title = d.subject || d.title || d.documentType || d.details || d.note || "";
  const s = String(title).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 120) : "(no title/details)";
}

function groupKey(salonId, createdByUid, type, fp) {
  return [salonId, createdByUid, type, fp].join("\u0001");
}

/**
 * Within a sorted-by-time list, split into clusters where consecutive docs
 * are within windowMs of each other (chain clustering).
 */
function clusterByTime(docs, windowMs) {
  if (!docs.length) return [];
  const sorted = [...docs].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = cur[cur.length - 1];
    if (sorted[i].createdAtMs - prev.createdAtMs <= windowMs) {
      cur.push(sorted[i]);
    } else {
      clusters.push(cur);
      cur = [sorted[i]];
    }
  }
  clusters.push(cur);
  return clusters.filter((c) => c.length >= 2);
}

function inRange(createdAt, start, end) {
  const d = tsToDate(createdAt);
  if (!d) return false;
  const ms = d.getTime();
  return ms >= start.getTime() && ms <= end.getTime();
}

async function loadInboxItemsInRange(db, { salonId, start, end }) {
  const out = [];
  // Full collection reads + client date filter (avoids missing composite indexes).
  const salonIds = salonId
    ? [salonId]
    : (await db.collection("salons").select().get()).docs.map((d) => d.id);

  console.log(`[find-inbox-dupes] Scanning ${salonIds.length} salon(s)…`);
  for (const sid of salonIds) {
    const snap = await db.collection("salons").doc(sid).collection("inboxItems").get();
    snap.forEach((d) => {
      const data = d.data() || {};
      if (!inRange(data.createdAt, start, end)) return;
      out.push({ salonId: sid, id: d.id, ...data });
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { start, end } = etDayBounds(args.fromYmd, args.toYmd);
  const windowMs = args.windowMinutes * 60 * 1000;

  await initAdmin(args.project);
  const db = admin.firestore();

  console.log(
    JSON.stringify(
      {
        phase: 1,
        mode: "identify-only",
        project: args.project,
        salonId: args.salonId || "(all salons)",
        fromYmd: args.fromYmd,
        toYmd: args.toYmd,
        timezone: "America/New_York (EDT -04:00)",
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        windowMinutes: args.windowMinutes,
      },
      null,
      2
    )
  );

  const rows = await loadInboxItemsInRange(db, {
    salonId: args.salonId || "",
    start,
    end,
  });
  console.log(`\nScanned ${rows.length} inboxItems in date range.\n`);

  const buckets = new Map();
  for (const row of rows) {
    const createdAt = tsToDate(row.createdAt);
    if (!createdAt) continue;
    const createdByUid = String(row.createdByUid || "").trim();
    const type = String(row.type || "").trim();
    if (!createdByUid || !type) continue;
    const fp = contentFingerprint(type, row.data);
    const key = groupKey(row.salonId, createdByUid, type, fp);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({
      salonId: row.salonId,
      id: row.id,
      createdByUid,
      createdByName: row.createdByName || "",
      createdByRole: row.createdByRole || "",
      type,
      status: row.status || "",
      forUid: row.forUid || "",
      forStaffName: row.forStaffName || "",
      createdAtMs: createdAt.getTime(),
      createdAtIso: createdAt.toISOString(),
      contentPreview: contentPreview(type, row.data),
      contentFp: fp.slice(0, 80),
    });
  }

  const duplicateGroups = [];
  for (const [, docs] of buckets) {
    if (docs.length < 2) continue;
    const clusters = clusterByTime(docs, windowMs);
    for (const cluster of clusters) {
      duplicateGroups.push(cluster);
    }
  }

  duplicateGroups.sort((a, b) => b.length - a.length || a[0].createdAtMs - b[0].createdAtMs);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate clusters found.");
    return;
  }

  console.log(`Found ${duplicateGroups.length} duplicate cluster(s):\n`);
  let totalExtra = 0;
  let totalDocs = 0;

  duplicateGroups.forEach((cluster, idx) => {
    totalDocs += cluster.length;
    totalExtra += cluster.length - 1;
    const first = cluster[0];
    const spanSec = Math.round((cluster[cluster.length - 1].createdAtMs - first.createdAtMs) / 1000);
    console.log("─".repeat(72));
    console.log(`Group #${idx + 1}`);
    console.log(`  salonId:        ${first.salonId}`);
    console.log(`  createdByUid:   ${first.createdByUid}`);
    console.log(`  createdByName:  ${first.createdByName || "(none)"}`);
    console.log(`  createdByRole:  ${first.createdByRole || "(none)"}`);
    console.log(`  type:           ${first.type}`);
    console.log(`  content:        ${first.contentPreview}`);
    console.log(`  docs:           ${cluster.length}  (span ${spanSec}s)`);
    console.log(`  keep (oldest):  ${first.id}  @ ${first.createdAtIso}`);
    console.log(`  delete candidates (${cluster.length - 1}):`);
    cluster.forEach((d, i) => {
      const tag = i === 0 ? "KEEP " : "DROP ";
      console.log(
        `    [${tag}] ${d.id}  status=${d.status}  for=${d.forStaffName || d.forUid || "?"}  @ ${d.createdAtIso}`
      );
    });
  });

  console.log("─".repeat(72));
  console.log(
    JSON.stringify(
      {
        clusters: duplicateGroups.length,
        totalDocsInClusters: totalDocs,
        deleteCandidatesIfKeepOldest: totalExtra,
      },
      null,
      2
    )
  );

  // Machine-readable dump for phase-2 approval
  const exportPayload = duplicateGroups.map((cluster, idx) => ({
    group: idx + 1,
    salonId: cluster[0].salonId,
    createdByUid: cluster[0].createdByUid,
    createdByName: cluster[0].createdByName,
    type: cluster[0].type,
    contentPreview: cluster[0].contentPreview,
    count: cluster.length,
    keepId: cluster[0].id,
    dropIds: cluster.slice(1).map((d) => d.id),
    ids: cluster.map((d) => d.id),
    createdAt: cluster.map((d) => d.createdAtIso),
  }));
  console.log("\n--- JSON (for phase-2) ---");
  console.log(JSON.stringify(exportPayload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
