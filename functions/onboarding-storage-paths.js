/**
 * Employee Onboarding — Storage path helpers (S1 security).
 *
 * New artifacts live OUTSIDE salons/{salonId}/… (same idea as timeClockPhotos).
 * Client Storage rules: read+write false; access only via Admin SDK / V4 signed URLs.
 *
 * Legacy paths under salons/… remain readable by path string on existing docs;
 * new writes always use onboardingArtifacts/.
 */

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

/** Library source PDF (manager upload → finalize). */
function librarySourcePath(salonId, documentId, versionId) {
  return `onboardingArtifacts/${trimStr(salonId)}/library/${trimStr(documentId)}/${trimStr(versionId)}/source.pdf`;
}

/** Portal employee upload (working + finalized copy). */
function portalUploadPath(salonId, staffId, runId, taskId, uploadId, safeName) {
  const name = trimStr(safeName) || "file";
  return (
    `onboardingArtifacts/${trimStr(salonId)}/portal/` +
    `${trimStr(staffId)}/${trimStr(runId)}/${trimStr(taskId)}/` +
    `${trimStr(uploadId)}_${name}`
  );
}

/** Ephemeral portal work files (fields.json / signature.png). */
function portalWorkBase(salonId, staffId, runId, taskId) {
  return (
    `onboardingArtifacts/${trimStr(salonId)}/portal/` +
    `${trimStr(staffId)}/${trimStr(runId)}/${trimStr(taskId)}`
  );
}

/** Sealed signed PDF / certificate after e-sign. */
function sealedPdfPath(salonId, staffId, runId, taskId, kind) {
  const file =
    kind === "certificate" || kind === "cert"
      ? "certificate.pdf"
      : "signed.pdf";
  return (
    `onboardingArtifacts/${trimStr(salonId)}/sealed/` +
    `${trimStr(staffId)}/${trimStr(runId)}/${trimStr(taskId)}/${file}`
  );
}

/** True if path is under the deny-all onboardingArtifacts tree. */
function isOnboardingArtifactPath(storagePath) {
  return trimStr(storagePath).startsWith("onboardingArtifacts/");
}

/** Legacy library path (pre-S1) — still valid for dual-read. */
function legacyLibrarySourcePath(salonId, documentId, versionId) {
  return `salons/${trimStr(salonId)}/onboarding-signature-library/${trimStr(documentId)}/${trimStr(versionId)}/source.pdf`;
}

module.exports = {
  librarySourcePath,
  portalUploadPath,
  portalWorkBase,
  sealedPdfPath,
  isOnboardingArtifactPath,
  legacyLibrarySourcePath,
};
