/**
 * Employee Onboarding E-Sign — Phase E3 seal pipeline (packet → submit → seal).
 *
 * Pure helpers used by onboarding-portal HTTP handlers.
 * No Portal Storage permissions for employees — all via Admin SDK / signed URLs.
 */

const {
  admin,
  HttpsError,
  PACKET_URL_TTL_MS,
  trimStr,
  sha256Buffer,
  sha256Text,
  sealIdFor,
  resolveBucket,
  esignCfg,
  documentIds,
  assertEsignAllowed,
  publicFieldSchema,
  publicEsignResult,
  validateEsignSubmission,
} = require("./onboarding-esign-seal-helpers");
const {
  downloadSourcePdf,
  overlaySignedPdf,
  buildCertificatePdf,
  writeAudit,
  upsertStaffDocument,
} = require("./onboarding-esign-seal-pdf");

async function sealEsignSubmission({
  salonId,
  staffId,
  runId,
  taskId,
  task,
  tokenId,
  ip,
  userAgent,
  validated,
}) {
  const cfg = esignCfg(task);
  const { documentId, documentVersionId } = documentIds(cfg);
  const sealId = sealIdFor(taskId, documentVersionId);
  const sealRef = db().doc(`salons/${salonId}/onboardingSealJobs/${sealId}`);

  // Atomic claim — prevents concurrent double-seal races.
  const LEASE_MS = 3 * 60 * 1000;
  let claimed = false;
  let earlyCompleted = null;
  await db().runTransaction(async (tx) => {
    const sealSnap = await tx.get(sealRef);
    const now = Date.now();
    if (sealSnap.exists) {
      const sj = sealSnap.data() || {};
      if (sj.status === "completed" && sj.signedPdfSha256) {
        earlyCompleted = {
          alreadySealed: true,
          sealId,
          result: sj.resultPublic || {
            sealId,
            signedPdfSha256: sj.signedPdfSha256,
            certificateSha256: sj.certificateSha256,
            signedDocumentId: sj.signedDocumentId,
            certificateDocumentId: sj.certificateDocumentId,
            signatureMethod: sj.signatureMethod,
            sourceDocumentSha256: sj.sourceDocumentSha256,
            documentVersionId,
            signedAt: sj.signedAtIso || null,
            signerName: sj.signerName || null,
            auditId: sj.auditId || null,
          },
        };
        return;
      }
      if (sj.status === "sealing") {
        const leaseUntil = Number(sj.leaseUntilMs || 0);
        if (leaseUntil && leaseUntil > now) {
          throw new HttpsError(
            "aborted",
            "Signature is already being sealed. Please wait a moment and try again."
          );
        }
        // Stale lease — reclaim
      }
    }
    tx.set(
      sealRef,
      {
        salonId,
        staffId,
        runId,
        taskId,
        documentId,
        documentVersionId,
        status: "sealing",
        sealId,
        leaseUntilMs: now + LEASE_MS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: sealSnap.exists
          ? sealSnap.get("createdAt") ||
            admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    claimed = true;
  });
  if (earlyCompleted) return earlyCompleted;
  if (!claimed) {
    throw new HttpsError("aborted", "Could not claim seal job. Please retry.");
  }

  const auditStartId = `seal_started_${sealId}`;
  await writeAudit(salonId, staffId, runId, taskId, auditStartId, {
    type: "seal_started",
    sealId,
    portalTokenId: tokenId,
    ip,
    userAgent: String(userAgent || "").slice(0, 300),
  });

  try {
    const source = await downloadSourcePdf(salonId, cfg);
    const signedBuf = await overlaySignedPdf(source.buf, validated);
    const signedPdfSha256 = sha256Buffer(signedBuf);

    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    const staffData = staffSnap.exists ? staffSnap.data() || {} : {};
    const signerName =
      validated.typedName ||
      trimStr(staffData.name || staffData.displayName) ||
      "Employee";
    const signerEmail = trimStr(staffData.email || staffData.workEmail || "");

    const signedAtIso = new Date().toISOString();
    const consentHash = sha256Text(validated.consentText);
    const fieldValuesHash = sha256Text(
      JSON.stringify(validated.fieldValues || {})
    );

    const certMeta = {
      salonId,
      staffId,
      runId,
      taskId,
      sealId,
      signerName,
      signerEmail,
      signedAtIso,
      signatureMethod: validated.signatureMethod,
      documentTitle: trimStr(cfg.documentTitle) || trimStr(task.templateNameSnapshot),
      documentVersion: cfg.documentVersion != null ? cfg.documentVersion : documentVersionId,
      documentVersionId,
      sourceSha256: source.sha,
      signedPdfSha256,
      ip,
      userAgent: String(userAgent || "").slice(0, 300),
      portalTokenId: tokenId,
      consentHash,
      fieldValuesHash,
      consentText: validated.consentText,
    };
    let certBuf = await buildCertificatePdf(certMeta);
    // Re-embed certificate hash into a second pass note — compute after first save
    const certificateSha256 = sha256Buffer(certBuf);

    const yyyyMm = signedAtIso.slice(0, 7);
    const docType = String(
      cfg.documentTitle || task.templateNameSnapshot || "E-Sign"
    )
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 60) || "E-Sign";
    const signedPath = `salons/${salonId}/staff/${staffId}/documents/${docType}/${yyyyMm}/${taskId}_signed.pdf`;
    const certPath = `salons/${salonId}/staff/${staffId}/documents/${docType}/${yyyyMm}/${taskId}_certificate.pdf`;

    const bucket = await resolveBucket();
    await bucket.file(signedPath).save(signedBuf, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        metadata: {
          sha256: signedPdfSha256,
          sealId,
          immutable: "true",
          via: "portal_esign",
        },
      },
    });
    await bucket.file(certPath).save(certBuf, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        metadata: {
          sha256: certificateSha256,
          sealId,
          immutable: "true",
          via: "portal_esign_certificate",
        },
      },
    });

    // Ephemeral portal working copies (Admin write; client denied by rules)
    try {
      const workBase = `salons/${salonId}/onboarding-portal/${staffId}/${runId}/${taskId}`;
      await bucket.file(`${workBase}/fields.json`).save(
        JSON.stringify({
          fieldValues: validated.fieldValues,
          consentHash,
          fieldValuesHash,
          sealedAt: signedAtIso,
        }),
        { contentType: "application/json", resumable: false }
      );
      if (validated.signaturePng) {
        await bucket.file(`${workBase}/signature.png`).save(validated.signaturePng, {
          contentType: "image/png",
          resumable: false,
        });
      }
    } catch (_) {
      /* non-fatal */
    }

    const signedDocumentId = `${taskId}_esign_signed`;
    const certificateDocumentId = `${taskId}_esign_certificate`;
    const docTitle =
      trimStr(cfg.documentTitle) ||
      trimStr(task.templateNameSnapshot) ||
      docType;
    const docVersionLabel =
      cfg.documentVersion != null ? cfg.documentVersion : documentVersionId;
    await upsertStaffDocument(salonId, staffId, signedDocumentId, {
      title: `${docTitle} — Signed`,
      type: docType,
      fileName: `${taskId}_signed.pdf`,
      storagePath: signedPath,
      approvalStatus: "approved",
      approvedBy: "portal_esign",
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      lifecycleStatus: "active",
      via: "portal_esign",
      esignKind: "signed_pdf",
      onboardingRunId: runId,
      onboardingTaskId: taskId,
      onboardingSealId: sealId,
      documentId,
      documentVersionId,
      documentTitle: docTitle,
      documentVersion: docVersionLabel,
      signerName,
      signedAt: signedAtIso,
      sourceDocumentSha256: source.sha,
      signedPdfSha256,
      sha256: signedPdfSha256,
      uploadedByUid: "onboarding_portal",
      readOnly: true,
    });
    await upsertStaffDocument(salonId, staffId, certificateDocumentId, {
      title: `${docTitle} — Signature Certificate`,
      type: `${docType} Certificate`,
      fileName: `${taskId}_certificate.pdf`,
      storagePath: certPath,
      approvalStatus: "approved",
      approvedBy: "portal_esign",
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      lifecycleStatus: "active",
      via: "portal_esign",
      esignKind: "certificate",
      onboardingRunId: runId,
      onboardingTaskId: taskId,
      onboardingSealId: sealId,
      documentId,
      documentVersionId,
      documentTitle: docTitle,
      documentVersion: docVersionLabel,
      signerName,
      signedAt: signedAtIso,
      certificateSha256,
      sha256: certificateSha256,
      uploadedByUid: "onboarding_portal",
      readOnly: true,
    });

    const auditId = `seal_completed_${sealId}`;
    await writeAudit(salonId, staffId, runId, taskId, auditId, {
      type: "seal_completed",
      sealId,
      portalTokenId: tokenId,
      ip,
      userAgent: String(userAgent || "").slice(0, 300),
      signerName,
      signerEmail,
      signedAtIso,
      signatureMethod: validated.signatureMethod,
      documentId,
      documentVersionId,
      documentSha256: source.sha,
      signedPdfSha256,
      certificateSha256,
      consentTextVersion: consentHash,
      fieldValuesHash,
      signedDocumentId,
      certificateDocumentId,
      signedStoragePath: signedPath,
      certificateStoragePath: certPath,
    });

    const resultPublic = {
      sealId,
      signedAt: signedAtIso,
      signerName,
      signedPdfSha256,
      certificateSha256,
      sourceDocumentSha256: source.sha,
      signatureMethod: validated.signatureMethod,
      signedDocumentId,
      certificateDocumentId,
      documentVersionId,
      auditId,
      via: "portal_esign",
    };

    await sealRef.set(
      {
        status: "completed",
        signedPdfSha256,
        certificateSha256,
        sourceDocumentSha256: source.sha,
        signedDocumentId,
        certificateDocumentId,
        signatureMethod: validated.signatureMethod,
        signedAtIso,
        auditId,
        resultPublic,
        signedStoragePath: signedPath,
        certificateStoragePath: certPath,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      alreadySealed: false,
      sealId,
      result: resultPublic,
      signerName,
    };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    await sealRef.set(
      {
        status: "failed",
        errorMessage: msg,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    try {
      await writeAudit(
        salonId,
        staffId,
        runId,
        taskId,
        `seal_failed_${Date.now()}`,
        {
          type: "seal_failed",
          sealId,
          portalTokenId: tokenId,
          ip,
          userAgent: String(userAgent || "").slice(0, 300),
          errorMessage: msg,
        }
      );
    } catch (_) {}
    throw e;
  }
}


module.exports = {
  sealIdFor,
  documentIds,
  esignCfg,
  assertEsignAllowed,
  publicFieldSchema,
  publicEsignResult,
  validateEsignSubmission,
  downloadSourcePdf,
  sealEsignSubmission,
  writeAudit,
  resolveBucket,
  PACKET_URL_TTL_MS,
  sha256Text,
};
