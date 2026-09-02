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
const { writeOnboardingAccessAudit } = require("./onboarding-access-audit");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");

/** Locked view copy so Safari cannot type into sealed AcroForm fields. */
async function lockedViewPath(bucket, salonId, storagePath, kind) {
  const p = trimStr(storagePath);
  if (!/\.pdf$/i.test(p)) return p;
  if (kind === "upload") return p;
  const viewId = crypto.createHash("sha256").update(p).digest("hex").slice(0, 40);
  const viewPath = `onboardingArtifacts/${trimStr(salonId)}/views/${viewId}.pdf`;
  const viewFile = bucket.file(viewPath);
  try {
    const [exists] = await viewFile.exists();
    if (exists) return viewPath;
  } catch (_) {}
  const [buf] = await bucket.file(p).download();
  const pdf = await PDFDocument.load(buf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  let locked = false;
  try {
    const form = pdf.getForm();
    if (form && typeof form.getFields === "function" && form.getFields().length) {
      form.flatten();
      locked = true;
    }
  } catch (_) {}
  if (!locked) return p;
  await viewFile.save(Buffer.from(await pdf.save()), {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      metadata: { sourcePath: p, purpose: "locked-view" },
    },
  });
  return viewPath;
}

function pathAllowedForSalon(storagePath, salonId, staffId) {
  const p = trimStr(storagePath);
  const sid = trimStr(salonId);
  if (!p || !sid) return false;
  if (p.startsWith(`onboardingArtifacts/${sid}/`)) return true;
  if (p.startsWith(`salons/${sid}/onboarding-signature-library/`)) return true;
  if (p.startsWith(`salons/${sid}/onboarding-portal/`)) return true;
  const staff = trimStr(staffId);
  if (staff && p.startsWith(`salons/${sid}/staff/${staff}/documents/`)) {
    return true;
  }
  return false;
}

async function pathFromStaffDocument(salonId, staffId, documentId) {
  const id = trimStr(documentId);
  if (!id) return "";
  try {
    const snap = await admin
      .firestore()
      .doc(`salons/${salonId}/staff/${staffId}/documents/${id}`)
      .get();
    if (!snap.exists) return "";
    const d = snap.data() || {};
    return trimStr(d.storagePath || d.filePath);
  } catch (_) {
    return "";
  }
}

async function pathFromSealJob(salonId, staffId, runId, taskId, sealId, kind) {
  const id = trimStr(sealId);
  if (!id) return "";
  try {
    const snap = await admin
      .firestore()
      .doc(`salons/${salonId}/onboardingSealJobs/${id}`)
      .get();
    if (!snap.exists) return "";
    const sj = snap.data() || {};
    if (trimStr(sj.staffId) && trimStr(sj.staffId) !== trimStr(staffId)) {
      return "";
    }
    if (trimStr(sj.runId) && trimStr(sj.runId) !== trimStr(runId)) {
      return "";
    }
    if (trimStr(sj.taskId) && trimStr(sj.taskId) !== trimStr(taskId)) {
      return "";
    }
    if (kind === "certificate" || kind === "cert") {
      return trimStr(sj.certificateStoragePath);
    }
    return trimStr(sj.signedStoragePath);
  } catch (_) {
    return "";
  }
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
  if (kind === "upload") {
    return trimStr(res.storagePath || res.filePath);
  }

  const isCert = kind === "certificate" || kind === "cert";
  const fromTask = isCert
    ? trimStr(res.certificateStoragePath)
    : trimStr(res.signedStoragePath);
  if (fromTask) return fromTask;

  const docId = isCert ? res.certificateDocumentId : res.signedDocumentId;
  const fromDoc = await pathFromStaffDocument(salonId, staffId, docId);
  if (fromDoc) return fromDoc;

  const fromSeal = await pathFromSealJob(
    salonId,
    staffId,
    runId,
    taskId,
    res.sealId,
    kind
  );
  if (fromSeal) return fromSeal;

  // Seal always writes here; older tasks omitted the path on task.result.
  const { sealedPdfPath } = require("./onboarding-storage-paths");
  return sealedPdfPath(
    salonId,
    staffId,
    runId,
    taskId,
    isCert ? "certificate" : "signed"
  );
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
  { region: REGION, timeoutSeconds: 60, memory: "512MiB" },
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

    function assertPathAllowed(p) {
      if (!pathAllowedForSalon(p, salonId, staffId)) {
        throw new HttpsError(
          "permission-denied",
          "Path is not an onboarding artifact for this salon."
        );
      }
      if (
        isOnboardingArtifactPath(p) &&
        !p.startsWith(`onboardingArtifacts/${salonId}/`)
      ) {
        throw new HttpsError("permission-denied", "Invalid artifact path.");
      }
    }

    const bucket = await resolveBucket();
    let file = null;
    let exists = false;
    if (storagePath) {
      assertPathAllowed(storagePath);
      file = bucket.file(storagePath);
      [exists] = await file.exists();
    }
    if (!exists && staffId && runId && taskId) {
      const fallback = await resolvePathFromTask(
        salonId,
        staffId,
        runId,
        taskId,
        kind
      );
      if (fallback && fallback !== storagePath) {
        assertPathAllowed(fallback);
        const fbFile = bucket.file(fallback);
        const [fbExists] = await fbFile.exists();
        if (fbExists) {
          storagePath = fallback;
          file = fbFile;
          exists = true;
        }
      }
    }

    if (!storagePath) {
      throw new HttpsError("not-found", "Artifact path not found.");
    }
    if (!exists || !file) {
      throw new HttpsError("not-found", "File missing in storage.");
    }

    let servePath = storagePath;
    try {
      servePath = await lockedViewPath(bucket, salonId, storagePath, kind);
    } catch (_) {
      servePath = storagePath;
    }
    const serveFile = servePath === storagePath ? file : bucket.file(servePath);

    // This project cannot mint V4 signed URLs (signBlob denied).
    // Download in the function and return bytes for the client to open.
    const [buf] = await serveFile.download();
    const maxBytes = 6.5 * 1024 * 1024;
    if (!buf || !buf.length || buf.length > maxBytes) {
      throw new HttpsError(
        "failed-precondition",
        "This file is too large to open here. Try a smaller PDF."
      );
    }
    let contentType = "application/octet-stream";
    try {
      const [meta] = await serveFile.getMetadata();
      contentType = String((meta && meta.contentType) || "").trim() || contentType;
    } catch (_) {}
    if (!contentType || contentType === "application/octet-stream") {
      if (/\.pdf$/i.test(servePath) || /\.pdf$/i.test(storagePath)) {
        contentType = "application/pdf";
      }
    }
    const fileBase64 = buf.toString("base64");
    const expiresMs = Date.now() + READ_URL_TTL_MS;

    try {
      await writeOnboardingAccessAudit({
        salonId,
        staffId,
        runId,
        taskId,
        uid,
        action: "artifact_read",
        storagePath,
        kind,
      });
    } catch (_) {}

    return {
      fileBase64,
      pdfBase64: contentType === "application/pdf" ? fileBase64 : null,
      contentType,
      readUrl: null,
      expiresAt: new Date(expiresMs).toISOString(),
      storagePath,
      ttlMs: READ_URL_TTL_MS,
    };
  }
);
