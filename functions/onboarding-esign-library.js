/**
 * Employee Onboarding E-Sign — Phase E1 Library + Phase E2 Field Schema.
 *
 * Manager (Firebase Auth + settings_manage / admin / owner):
 *   createOnboardingSignatureDocument
 *   updateOnboardingSignatureDocument
 *   createOnboardingSignatureDocumentVersionUpload
 *   finalizeOnboardingSignatureDocumentVersion
 *   getOnboardingSignatureDocumentVersionReadUrl
 *   getOnboardingArtifactReadUrl
 *   setOnboardingSignatureDocumentVersionFieldSchema
 *   bindOnboardingSignatureDocumentVersions
 *
 * Upload path: reserve → client PUT via V4 signed URL → finalize (PDF/size/pages/SHA-256).
 * Field schema saved on version; versions bound to a Run become immutable.
 * Regulated compliance tiers are blocked.
 * S1: artifacts under onboardingArtifacts/ — client Storage read+write denied.
 */

Object.assign(
  exports,
  require("./onboarding-esign-library-docs"),
  require("./onboarding-esign-library-schema"),
  require("./onboarding-esign-library-read")
);
