/**
 * Employee Onboarding E-Sign library — document CRUD + version upload/finalize.
 */
const {
  admin,
  onCall,
  HttpsError,
  REGION,
  UPLOAD_URL_TTL_MS,
  MAX_SIZE_BYTES,
  MAX_PAGES,
  PDF_MIME,
  REGULATED_TIERS,
  db,
  requireAuth,
  trimStr,
  assertCanManageOnboardingSettings,
  assertStandardTier,
  normalizeComplianceTier,
  docsCol,
  docRef,
  versionsCol,
  resolveBucket,
  isPdfMagic,
  sha256Buffer,
  countPdfPages,
  safeFileName,
  versionIsImmutable,
} = require("./onboarding-esign-library-helpers");

exports.createOnboardingSignatureDocument = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const title = trimStr(request.data && request.data.title);
    const category = trimStr(request.data && request.data.category);
    const notes = trimStr(request.data && request.data.notes);
    if (!salonId || !title) {
      throw new HttpsError("invalid-argument", "Missing salonId or title.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);
    const complianceTier = assertStandardTier(
      request.data && request.data.complianceTier
    );

    const ref = docsCol(salonId).doc();
    const row = {
      id: ref.id,
      title,
      category,
      notes: notes || "",
      complianceTier,
      allowInternalEsign: true,
      active: true,
      archived: false,
      currentVersionId: null,
      versionCount: 0,
      createdByUid: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(row);
    return { documentId: ref.id, document: { ...row, id: ref.id } };
  }
);

exports.updateOnboardingSignatureDocument = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const documentId = trimStr(request.data && request.data.documentId);
    if (!salonId || !documentId) {
      throw new HttpsError("invalid-argument", "Missing salonId or documentId.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);

    const ref = docRef(salonId, documentId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Document not found.");
    const cur = snap.data() || {};

    const patch = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
    };

    if (request.data && request.data.title !== undefined) {
      const title = trimStr(request.data.title);
      if (!title) throw new HttpsError("invalid-argument", "Title cannot be empty.");
      patch.title = title;
    }
    if (request.data && request.data.category !== undefined) {
      patch.category = trimStr(request.data.category);
    }
    if (request.data && request.data.notes !== undefined) {
      patch.notes = trimStr(request.data.notes);
    }
    if (request.data && request.data.archived !== undefined) {
      const archived = request.data.archived === true;
      patch.archived = archived;
      patch.active = !archived;
    }
    if (request.data && request.data.active !== undefined) {
      const active = request.data.active !== false;
      patch.active = active;
      patch.archived = !active;
    }
    if (request.data && request.data.complianceTier !== undefined) {
      // Never allow flipping an existing library doc into a regulated tier.
      patch.complianceTier = assertStandardTier(request.data.complianceTier);
      patch.allowInternalEsign = true;
    } else if (REGULATED_TIERS.has(normalizeComplianceTier(cur.complianceTier))) {
      throw new HttpsError(
        "failed-precondition",
        "This document is classified as regulated and cannot be used in the generic e-sign library."
      );
    }

    await ref.set(patch, { merge: true });
    const fresh = await ref.get();
    return { documentId, document: { ...(fresh.data() || {}), id: documentId } };
  }
);

exports.createOnboardingSignatureDocumentVersionUpload = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const documentId = trimStr(request.data && request.data.documentId);
    const fileName = trimStr(request.data && request.data.fileName) || "document.pdf";
    const size = Number(request.data && request.data.size) || 0;
    const contentType =
      trimStr(request.data && request.data.contentType) || PDF_MIME;
    const notes = trimStr(request.data && request.data.notes);

    if (!salonId || !documentId) {
      throw new HttpsError("invalid-argument", "Missing salonId or documentId.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);

    if (contentType !== PDF_MIME && !/\.pdf$/i.test(fileName)) {
      throw new HttpsError("invalid-argument", "Only PDF uploads are allowed.");
    }
    if (contentType && contentType !== PDF_MIME) {
      throw new HttpsError("invalid-argument", "contentType must be application/pdf.");
    }
    if (size > MAX_SIZE_BYTES) {
      throw new HttpsError(
        "invalid-argument",
        `PDF must be ${MAX_SIZE_BYTES / (1024 * 1024)} MB or smaller.`
      );
    }

    const dref = docRef(salonId, documentId);
    const dsnap = await dref.get();
    if (!dsnap.exists) throw new HttpsError("not-found", "Document not found.");
    const docRow = dsnap.data() || {};
    assertStandardTier(docRow.complianceTier);
    if (docRow.archived === true || docRow.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "Document is archived. Unarchive before uploading a new version."
      );
    }

    const versionRef = versionsCol(salonId, documentId).doc();
    const versionId = versionRef.id;
    const safeName = safeFileName(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    const { librarySourcePath } = require("./onboarding-storage-paths");
    const storagePath = librarySourcePath(salonId, documentId, versionId);
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + UPLOAD_URL_TTL_MS
    );

    await versionRef.set({
      id: versionId,
      documentId,
      status: "reserved",
      storagePath,
      contentType: PDF_MIME,
      originalFileName: safeName,
      declaredSize: size || null,
      maxSizeBytes: MAX_SIZE_BYTES,
      maxPages: MAX_PAGES,
      sha256: null,
      pageCount: null,
      sizeBytes: null,
      fieldSchema: [],
      complianceTier: "standard",
      notes: notes || "",
      uploadedByUid: uid,
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      finalizedAt: null,
      errorMessage: null,
    });

    const stagingPath = `onboardingUploads/${salonId}/${uid}/${versionId}.pdf`;
    const bucket = await resolveBucket();
    const file = bucket.file(storagePath);
    let uploadUrl = null;
    try {
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + UPLOAD_URL_TTL_MS,
        contentType: PDF_MIME,
      });
      uploadUrl = url;
    } catch (signErr) {
      console.warn("[EsignLibrary] getSignedUrl unavailable, client will use staging upload", signErr && signErr.message);
    }

    return {
      documentId,
      versionId,
      uploadUrl,
      stagingPath,
      storagePath,
      contentType: PDF_MIME,
      maxSizeBytes: MAX_SIZE_BYTES,
      maxPages: MAX_PAGES,
      expiresAt: expiresAt.toDate().toISOString(),
    };
  }
);

exports.finalizeOnboardingSignatureDocumentVersion = onCall(
  { region: REGION, timeoutSeconds: 120, memory: "512MiB" },
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

    // Idempotent: already finalized
    if (ver.status === "ready" && ver.sha256) {
      return {
        ok: true,
        documentId,
        versionId,
        sha256: ver.sha256,
        pageCount: ver.pageCount,
        sizeBytes: ver.sizeBytes,
        currentVersionId: docRow.currentVersionId || versionId,
        alreadyFinalized: true,
      };
    }
    if (ver.status === "ready") {
      throw new HttpsError(
        "failed-precondition",
        "Version is already finalized and immutable."
      );
    }
    if (ver.status === "failed") {
      throw new HttpsError(
        "failed-precondition",
        ver.errorMessage || "Version previously failed validation."
      );
    }

    const exp =
      ver.expiresAt && ver.expiresAt.toMillis ? ver.expiresAt.toMillis() : 0;
    if (exp && exp < Date.now()) {
      throw new HttpsError("deadline-exceeded", "Upload slot expired.");
    }
    if (trimStr(ver.uploadedByUid) && trimStr(ver.uploadedByUid) !== uid) {
      // Allow any settings manager to finalize a reserved upload for the salon.
      // uploadedByUid is audit only.
    }

    const storagePath = trimStr(ver.storagePath);
    if (!storagePath) {
      throw new HttpsError("failed-precondition", "Missing storage path.");
    }

    const bucket = await resolveBucket();
    const file = bucket.file(storagePath);
    const stagingPath = trimStr(request.data && request.data.stagingPath);
    if (stagingPath) {
      if (!stagingPath.startsWith(`onboardingUploads/${salonId}/`)) {
        throw new HttpsError("invalid-argument", "Invalid staging path.");
      }
      const stagingFile = bucket.file(stagingPath);
      const [stagingExists] = await stagingFile.exists();
      if (stagingExists) {
        await stagingFile.copy(file);
        try { await stagingFile.delete({ ignoreNotFound: true }); } catch (_) {}
      }
    }

    async function markFailed(message) {
      await vref.set(
        {
          status: "failed",
          errorMessage: String(message || "Validation failed").slice(0, 500),
          finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (_) {
        /* ignore */
      }
    }

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("failed-precondition", "File not uploaded yet.");
    }

    const [meta] = await file.getMetadata();
    const sizeBytes = Number(meta.size || 0);
    const metaType = trimStr(meta.contentType).toLowerCase();
    if (sizeBytes <= 0) {
      await markFailed("Empty file.");
      throw new HttpsError("invalid-argument", "Empty file.");
    }
    if (sizeBytes > MAX_SIZE_BYTES) {
      await markFailed(`File exceeds ${MAX_SIZE_BYTES / (1024 * 1024)} MB.`);
      throw new HttpsError(
        "invalid-argument",
        `PDF must be ${MAX_SIZE_BYTES / (1024 * 1024)} MB or smaller.`
      );
    }
    if (metaType && metaType !== PDF_MIME && metaType !== "application/octet-stream") {
      await markFailed(`Invalid content type: ${metaType}`);
      throw new HttpsError("invalid-argument", "Only PDF uploads are allowed.");
    }

    let buf;
    try {
      const [downloaded] = await file.download();
      buf = downloaded;
    } catch (e) {
      throw new HttpsError(
        "internal",
        "Failed to read uploaded file: " + (e && e.message ? e.message : e)
      );
    }

    if (!isPdfMagic(buf)) {
      await markFailed("Not a valid PDF (magic bytes).");
      throw new HttpsError("invalid-argument", "Only PDF uploads are allowed.");
    }

    let pageCount;
    try {
      pageCount = await countPdfPages(buf);
    } catch (e) {
      await markFailed("Invalid or unreadable PDF.");
      throw new HttpsError(
        "invalid-argument",
        "Invalid or unreadable PDF: " + (e && e.message ? e.message : e)
      );
    }
    if (!(pageCount > 0)) {
      await markFailed("PDF has no pages.");
      throw new HttpsError("invalid-argument", "PDF has no pages.");
    }
    if (pageCount > MAX_PAGES) {
      await markFailed(`PDF exceeds ${MAX_PAGES} pages (${pageCount}).`);
      throw new HttpsError(
        "invalid-argument",
        `PDF must be ${MAX_PAGES} pages or fewer (got ${pageCount}).`
      );
    }

    const sha256 = sha256Buffer(buf);

    // Immutable finalize: only transition reserved → ready once.
    await db().runTransaction(async (tx) => {
      const freshV = await tx.get(vref);
      if (!freshV.exists) throw new HttpsError("not-found", "Version not found.");
      const vd = freshV.data() || {};
      if (vd.status === "ready") return;
      if (vd.status !== "reserved") {
        throw new HttpsError(
          "failed-precondition",
          "Version is not in a finalizable state."
        );
      }
      const freshD = await tx.get(dref);
      if (!freshD.exists) throw new HttpsError("not-found", "Document not found.");
      const dd = freshD.data() || {};
      assertStandardTier(dd.complianceTier);

      const nextVersionNumber = Number(dd.versionCount || 0) + 1;
      tx.set(
        vref,
        {
          status: "ready",
          sha256,
          pageCount,
          sizeBytes,
          contentType: PDF_MIME,
          documentVersion: nextVersionNumber,
          fieldSchema: Array.isArray(vd.fieldSchema) ? vd.fieldSchema : [],
          schemaFrozen: false,
          boundRunCount: 0,
          errorMessage: null,
          finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
          finalizedByUid: uid,
        },
        { merge: true }
      );
      tx.set(
        dref,
        {
          currentVersionId: versionId,
          versionCount: nextVersionNumber,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedByUid: uid,
        },
        { merge: true }
      );
    });

    // Best-effort: lock object metadata (no client overwrite path anyway).
    try {
      await file.setMetadata({
        contentType: PDF_MIME,
        metadata: {
          sha256,
          documentId,
          versionId,
          immutable: "true",
        },
      });
    } catch (_) {
      /* ignore */
    }

    return {
      ok: true,
      documentId,
      versionId,
      sha256,
      pageCount,
      sizeBytes,
      storagePath,
      currentVersionId: versionId,
      alreadyFinalized: false,
    };
  }
);

// ─── E2: PDF read URL + field schema + Run bind freeze ───────────────────────

