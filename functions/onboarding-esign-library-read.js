/**
 * Employee Onboarding S1 — short-lived signed read URLs for artifacts.
 * Client Storage rules deny read; UI must use these callables (never getDownloadURL).
 */
const {
  admin,
  onCall,
  HttpsError,
  REGION,
  READ_URL_TTL_MS,
  trimStr,
  resolveBucket,
} = require("./onboarding-esign-library-helpers");
const {
  requireManagerAuth,
  assertManager,
} = require("./onboarding-portal-shared-core");
const { isOnboardingArtifactPath } = require("./onboarding-storage-paths");

function pathAllowedForSalon(storagePath, salonId, staffId) {
  const p = trimStr(storagePath);
  const sid = trimStr(salonId);
  if (!p || !sid) return false;
  if (p.startsWith(`onboardingArtifacts/${sid}/`)) return true;
  if (p.startsWith(`salons/${sid}/onboarding-signature-library/`)) return true;
  if (p.startsWith(`salons/${sid}/onboarding-portal/`)) return true;
  const staff = trimStr(staffId);
  if (
    staff &&
    p.startsWith(`salons/${sid}/staff/${staff}/documents/`) &&
    (/_signed\.pdf$/i.test(p) || /_certificate\.pdf$/i.test(p))
  ) {
    return true;
  }
  return false;
}

async function resolvePathFromTask(salonId, staffId, runId, taskId, kind) {
  const taskRef = admin
    .firestore()
    .doc(
      `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks/${taskId}`
    );
  const snap = await taskRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
  const task = snap.data() || {};
  const res = task.result || {};
  if (kind === "certificate" || kind === "cert") {
    return trimStr(res.certificateStoragePath);
  }
  if (kind === "upload") {
    return trimStr(res.storagePath || res.filePath);
  }
  return trimStr(res.signedStoragePath);
}

/**
 * getOnboardingArtifactReadUrl
 * data: {
 *   salonId,
 *   storagePath?,          // explicit path (validated)
 *   staffId?, runId?, taskId?, kind?: 'signed'|'certificate'|'upload'
 * }
 */
exports.getOnboardingArtifactReadUrl = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const kind = trimStr(request.data && request.data.kind) || "signed";
    let storagePath = trimStr(request.data && request.data.storagePath);

    if (!salonId) {
      throw new HttpsError("invalid-argument", "Missing salonId.");
    }
    await assertManager(uid, salonId);

    if (!storagePath) {
      if (!staffId || !runId || !taskId) {
        throw new HttpsError(
          "invalid-argument",
          "Provide storagePath or staffId+runId+taskId."
        );
      }
      storagePath = await resolvePathFromTask(
        salonId,
        staffId,
        runId,
        taskId,
        kind
      );
    }

    if (!storagePath) {
      throw new HttpsError("not-found", "Artifact path not found.");
    }
    if (!pathAllowedForSalon(storagePath, salonId, staffId)) {
      throw new HttpsError(
        "permission-denied",
        "Path is not an onboarding artifact for this salon."
      );
    }
    // Extra guard: artifact tree must never be guessed across salons
    if (
      isOnboardingArtifactPath(storagePath) &&
      !storagePath.startsWith(`onboardingArtifacts/${salonId}/`)
    ) {
      throw new HttpsError("permission-denied", "Invalid artifact path.");
    }

    const bucket = await resolveBucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError("not-found", "File missing in storage.");

    const expiresMs = Date.now() + READ_URL_TTL_MS;
    const [readUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresMs,
    });

    return {
      readUrl,
      expiresAt: new Date(expiresMs).toISOString(),
      storagePath,
      ttlMs: READ_URL_TTL_MS,
    };
  }
);
