/**
 * Employee Onboarding S8 — retention helpers (unused as product).
 * Automatic 7-year archive was removed: salon keeps its own copies.
 * Daily purge and live purge are disabled.
 *
 *   setOnboardingRetentionYears
 *   runOnboardingRetentionPurge   (dryRun default true)
 *   onboardingRetentionDaily
 *
 * Library source PDFs are never purged. Live files younger than the
 * salon policy are never deleted.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {
  REGION,
  trimStr,
  resolveBucket,
  assertCanManageOnboardingSettings,
  requireAuth,
} = require("./onboarding-esign-library-helpers");

if (!admin.apps.length) admin.initializeApp();

const DEFAULT_YEARS = 7;
const MIN_YEARS = 1;
const MAX_YEARS = 15;
const VIEW_CACHE_DAYS = 90;
const WORK_FILE_DAYS = 90;
const MS_DAY = 24 * 60 * 60 * 1000;
const MS_YEAR = 365.25 * MS_DAY;

function db() {
  return admin.firestore();
}

function clampYears(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_YEARS;
  return Math.min(MAX_YEARS, Math.max(MIN_YEARS, Math.round(n)));
}

async function retentionYearsForSalon(salonId) {
  const sid = trimStr(salonId);
  if (!sid) return DEFAULT_YEARS;
  const snap = await db().doc(`salons/${sid}`).get();
  const data = snap.exists ? snap.data() || {} : {};
  return clampYears(data.onboardingRetentionYears);
}

function retainUntilMsFrom(fromMs, years) {
  const base = Number(fromMs) || Date.now();
  return Math.round(base + clampYears(years) * MS_YEAR);
}

function fileCreatedMs(file) {
  const raw = file && file.metadata && file.metadata.timeCreated;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function shouldPurgeArtifact(name, createdMs, years, nowMs) {
  const parts = String(name || "").split("/");
  if (parts[0] !== "onboardingArtifacts" || parts.length < 3) return false;
  const kind = parts[2];
  if (kind === "library") return false;
  const yearCutoff = nowMs - clampYears(years) * MS_YEAR;
  if (kind === "views") {
    return createdMs > 0 && createdMs <= nowMs - VIEW_CACHE_DAYS * MS_DAY;
  }
  if (kind === "portal") {
    const base = parts[parts.length - 1] || "";
    if (/^(fields\.json|signature\.png)$/i.test(base)) {
      return createdMs > 0 && createdMs <= nowMs - WORK_FILE_DAYS * MS_DAY;
    }
    return createdMs > 0 && createdMs <= yearCutoff;
  }
  if (kind === "sealed") {
    return createdMs > 0 && createdMs <= yearCutoff;
  }
  return createdMs > 0 && createdMs <= yearCutoff;
}

async function markStaffDocPurged(storagePath) {
  const m = String(storagePath || "").match(
    /^onboardingArtifacts\/([^/]+)\/sealed\/([^/]+)\/([^/]+)\/([^/]+)\/(signed|certificate)\.pdf$/i
  );
  if (!m) return;
  const salonId = m[1];
  const staffId = m[2];
  const taskId = m[4];
  const kind = String(m[5]).toLowerCase();
  const docId =
    kind === "certificate"
      ? `${taskId}_esign_certificate`
      : `${taskId}_esign_signed`;
  await db()
    .doc(`salons/${salonId}/staff/${staffId}/documents/${docId}`)
    .set(
      {
        storagePath: null,
        fileUrl: null,
        lifecycleStatus: "purged",
        purgedAt: admin.firestore.FieldValue.serverTimestamp(),
        purgeReason: "retention",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch(() => {});
}

async function purgeAccessAudit(salonId, cutoffMs, dryRun, limit) {
  const q = await db()
    .collection(`salons/${salonId}/onboardingAccessAudit`)
    .where("createdAt", "<", admin.firestore.Timestamp.fromMillis(cutoffMs))
    .limit(Math.min(200, limit || 200))
    .get();
  if (dryRun) return q.size;
  const batch = db().batch();
  q.docs.forEach((d) => batch.delete(d.ref));
  if (!q.empty) await batch.commit();
  return q.size;
}

async function runRetentionPurge({ dryRun = true, limit = 200 } = {}) {
  const bucket = await resolveBucket();
  const [files] = await bucket.getFiles({ prefix: "onboardingArtifacts/" });
  const nowMs = Date.now();
  const yearsCache = {};
  const expired = [];
  for (const file of files) {
    const name = file.name;
    const parts = name.split("/");
    if (parts[0] !== "onboardingArtifacts" || parts.length < 3) continue;
    const salonId = parts[1];
    if (!yearsCache[salonId]) {
      yearsCache[salonId] = await retentionYearsForSalon(salonId);
    }
    const years = yearsCache[salonId];
    const createdMs = fileCreatedMs(file);
    if (!shouldPurgeArtifact(name, createdMs, years, nowMs)) continue;
    expired.push({
      path: name,
      salonId,
      createdAt: file.metadata && file.metadata.timeCreated,
      years,
    });
  }

  const cap = Math.max(1, Math.min(500, Number(limit) || 200));
  const toDelete = expired.slice(0, cap);
  let deleted = 0;
  let errors = 0;
  if (!dryRun) {
    for (const row of toDelete) {
      try {
        await bucket.file(row.path).delete({ ignoreNotFound: true });
        await markStaffDocPurged(row.path);
        deleted += 1;
      } catch (e) {
        errors += 1;
        console.warn("[onboardingRetention] delete failed", {
          path: row.path,
          message: e && e.message,
        });
      }
    }
  }

  let auditDeleted = 0;
  for (const salonId of Object.keys(yearsCache)) {
    const cutoff = nowMs - yearsCache[salonId] * MS_YEAR;
    try {
      auditDeleted += await purgeAccessAudit(salonId, cutoff, dryRun, cap);
    } catch (_) {}
  }

  const summary = {
    dryRun: !!dryRun,
    scanned: files.length,
    expiredCount: expired.length,
    deleted,
    auditExpired: auditDeleted,
    errors,
    sample: expired.slice(0, 15),
    defaultYears: DEFAULT_YEARS,
  };

  try {
    await db()
      .collection("onboardingRetentionPurgeLog")
      .add({
        ...summary,
        sample: summary.sample,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (_) {}

  return summary;
}

exports.retentionYearsForSalon = retentionYearsForSalon;
exports.retainUntilMsFrom = retainUntilMsFrom;
exports.DEFAULT_YEARS = DEFAULT_YEARS;
exports.MIN_YEARS = MIN_YEARS;
exports.MAX_YEARS = MAX_YEARS;

exports.setOnboardingRetentionYears = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    if (!salonId) throw new HttpsError("invalid-argument", "Missing salonId.");
    await assertCanManageOnboardingSettings(uid, salonId);
    const years = clampYears(request.data && request.data.years);
    await db()
      .doc(`salons/${salonId}`)
      .set(
        {
          onboardingRetentionYears: years,
          onboardingRetentionUpdatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          onboardingRetentionUpdatedByUid: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return { ok: true, years, defaultYears: DEFAULT_YEARS };
  }
);

exports.runOnboardingRetentionPurge = onCall(
  { region: REGION, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    if (!salonId) throw new HttpsError("invalid-argument", "Missing salonId.");
    await assertCanManageOnboardingSettings(uid, salonId);
    throw new HttpsError(
      "failed-precondition",
      "Automatic document retention is off. The salon keeps its own copies."
    );
  }
);

exports.onboardingRetentionDaily = onSchedule(
  {
    schedule: "15 4 * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    // Product: Fair Flow does not keep a legal archive. No automatic purge.
    console.log("[onboardingRetentionDaily] skipped — retention purge disabled");
    return { skipped: true, reason: "retention_disabled" };
  }
);
