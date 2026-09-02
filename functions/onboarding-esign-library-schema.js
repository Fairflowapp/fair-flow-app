/**
 * Employee Onboarding E-Sign library — read URLs, field schema, version bind.
 */
const {
  admin,
  onCall,
  HttpsError,
  REGION,
  READ_URL_TTL_MS,
  requireAuth,
  trimStr,
  assertCanManageOnboardingSettings,
  assertStandardTier,
  docsCol,
  docRef,
  versionsCol,
  resolveBucket,
  normalizeAndValidateFieldSchema,
  versionIsImmutable,
} = require("./onboarding-esign-library-helpers");
const { writeOnboardingAccessAudit } = require("./onboarding-access-audit");

exports.getOnboardingSignatureDocumentVersionReadUrl = onCall(
  { region: REGION, timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const documentId = trimStr(request.data && request.data.documentId);
    const versionId = trimStr(request.data && request.data.versionId);
    if (!salonId || !documentId || !versionId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, documentId, or versionId."
      );
    }
    await assertCanManageOnboardingSettings(uid, salonId);

    const dref = docRef(salonId, documentId);
    const vref = versionsCol(salonId, documentId).doc(versionId);
    const [dsnap, vsnap] = await Promise.all([dref.get(), vref.get()]);
    if (!dsnap.exists) throw new HttpsError("not-found", "Document not found.");
    if (!vsnap.exists) throw new HttpsError("not-found", "Version not found.");
    const docRow = dsnap.data() || {};
    const ver = vsnap.data() || {};
    assertStandardTier(docRow.complianceTier);
    if (ver.status !== "ready") {
      throw new HttpsError(
        "failed-precondition",
        "Version is not ready for preview."
      );
    }
    const storagePath = trimStr(ver.storagePath);
    if (!storagePath) {
      throw new HttpsError("failed-precondition", "Missing storage path.");
    }

    const bucket = await resolveBucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError("not-found", "PDF file missing in storage.");

    const expiresMs = Date.now() + READ_URL_TTL_MS;
    let pdfBase64 = null;
    try {
      const [buf] = await file.download();
      // Callable response limit is ~10MB; base64 adds ~33%.
      if (buf && buf.length && buf.length <= 6.5 * 1024 * 1024) {
        pdfBase64 = buf.toString("base64");
      }
    } catch (dlErr) {
      console.warn("[EsignLibrary] preview download failed", dlErr && dlErr.message);
    }
    if (!pdfBase64) {
      throw new HttpsError(
        "internal",
        "Could not open the PDF to mark signatures. Try a smaller PDF."
      );
    }

    try {
      await writeOnboardingAccessAudit({
        salonId,
        uid,
        action: "library_preview",
        storagePath,
        kind: "library",
        extra: { documentId, versionId },
      });
    } catch (_) {}

    return {
      documentId,
      versionId,
      pdfBase64,
      readUrl: null,
      previewPath: null,
      expiresAt: new Date(expiresMs).toISOString(),
      sha256: ver.sha256 || null,
      pageCount: ver.pageCount || null,
      documentVersion: ver.documentVersion || null,
      fieldSchema: Array.isArray(ver.fieldSchema) ? ver.fieldSchema : [],
      schemaFrozen: versionIsImmutable(ver),
      documentTitle: trimStr(docRow.title),
      originalFileName: ver.originalFileName || "source.pdf",
    };
  }
);

exports.setOnboardingSignatureDocumentVersionFieldSchema = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const documentId = trimStr(request.data && request.data.documentId);
    const versionId = trimStr(request.data && request.data.versionId);
    if (!salonId || !documentId || !versionId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, documentId, or versionId."
      );
    }
    await assertCanManageOnboardingSettings(uid, salonId);

    const dref = docRef(salonId, documentId);
    const vref = versionsCol(salonId, documentId).doc(versionId);
    const [dsnap, vsnap] = await Promise.all([dref.get(), vref.get()]);
    if (!dsnap.exists) throw new HttpsError("not-found", "Document not found.");
    if (!vsnap.exists) throw new HttpsError("not-found", "Version not found.");
    const docRow = dsnap.data() || {};
    const ver = vsnap.data() || {};
    assertStandardTier(docRow.complianceTier);
    if (ver.status !== "ready") {
      throw new HttpsError(
        "failed-precondition",
        "Only ready versions can receive a field layout."
      );
    }
    if (versionIsImmutable(ver)) {
      throw new HttpsError(
        "failed-precondition",
        "This version is immutable because it is already linked to an onboarding run."
      );
    }

    const fieldSchema = normalizeAndValidateFieldSchema(
      request.data && request.data.fieldSchema,
      ver.pageCount
    );

    await vref.set(
      {
        fieldSchema,
        fieldSchemaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        fieldSchemaUpdatedByUid: uid,
      },
      { merge: true }
    );
    await dref.set(
      {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: uid,
      },
      { merge: true }
    );

    return {
      ok: true,
      documentId,
      versionId,
      fieldSchema,
      sha256: ver.sha256 || null,
      pageCount: ver.pageCount || null,
      documentVersion: ver.documentVersion || null,
      schemaFrozen: false,
    };
  }
);

/**
 * Mark library versions as immutable after they are snapshotted into a Run.
 * data.bindings: [{ documentId, versionId, runId }]
 */
exports.bindOnboardingSignatureDocumentVersions = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const bindings = Array.isArray(request.data && request.data.bindings)
      ? request.data.bindings
      : [];
    if (!salonId) throw new HttpsError("invalid-argument", "Missing salonId.");
    if (!bindings.length) return { ok: true, frozen: 0 };
    await assertCanManageOnboardingSettings(uid, salonId);

    let frozen = 0;
    for (const b of bindings) {
      const documentId = trimStr(b && b.documentId);
      const versionId = trimStr(b && b.versionId);
      const runId = trimStr(b && b.runId);
      if (!documentId || !versionId) continue;
      const vref = versionsCol(salonId, documentId).doc(versionId);
      const snap = await vref.get();
      if (!snap.exists) continue;
      const ver = snap.data() || {};
      if (ver.status !== "ready") continue;
      await vref.set(
        {
          schemaFrozen: true,
          immutable: true,
          boundRunCount: Number(ver.boundRunCount || 0) + 1,
          lastBoundRunId: runId || null,
          lastBoundAt: admin.firestore.FieldValue.serverTimestamp(),
          lastBoundByUid: uid,
        },
        { merge: true }
      );
      frozen += 1;
    }
    return { ok: true, frozen };
  }
);
