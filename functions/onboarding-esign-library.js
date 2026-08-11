/**
 * Employee Onboarding E-Sign — Phase E1 Library + Phase E2 Field Schema.
 *
 * Manager (Firebase Auth + settings_manage / admin / owner):
 *   createOnboardingSignatureDocument
 *   updateOnboardingSignatureDocument
 *   createOnboardingSignatureDocumentVersionUpload
 *   finalizeOnboardingSignatureDocumentVersion
 *   getOnboardingSignatureDocumentVersionReadUrl
 *   setOnboardingSignatureDocumentVersionFieldSchema
 *   bindOnboardingSignatureDocumentVersions
 *
 * Upload path: reserve → client PUT via V4 signed URL → finalize (PDF/size/pages/SHA-256).
 * Field schema saved on version; versions bound to a Run become immutable.
 * Regulated compliance tiers are blocked.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { PDFDocument } = require("pdf-lib");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();

const REGION = "us-central1";
const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;
const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;
const PDF_MIME = "application/pdf";
const READ_URL_TTL_MS = 30 * 60 * 1000;
const MAX_FIELDS = 100;
const FIELD_TYPES = new Set([
  "signature",
  "typed_name",
  "date",
  "initials",
  "text",
  "checkbox",
]);
const REGULATED_TIERS = new Set([
  "regulated_tax",
  "regulated_i9",
  "regulated_other",
]);

function db() {
  return admin.firestore();
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

/** Project-derived Storage bucket (never hardcode production). */
let _bucketPromise = null;
function resolveBucket() {
  if (!_bucketPromise) {
    _bucketPromise = (async () => {
      const project =
        process.env.GCLOUD_PROJECT ||
        trimStr((admin.app().options || {}).projectId);
      for (const id of [
        `${project}.firebasestorage.app`,
        `${project}.appspot.com`,
      ]) {
        try {
          const bucket = admin.storage().bucket(id);
          const [exists] = await bucket.exists();
          if (exists) return bucket;
        } catch (_) {
          /* try next */
        }
      }
      return admin.storage().bucket();
    })();
  }
  return _bucketPromise;
}

function normalizeComplianceTier(raw) {
  const t = trimStr(raw).toLowerCase() || "standard";
  if (
    t === "standard" ||
    t === "regulated_tax" ||
    t === "regulated_i9" ||
    t === "regulated_other"
  ) {
    return t;
  }
  return "standard";
}

function assertStandardTier(tier) {
  const t = normalizeComplianceTier(tier);
  if (t !== "standard" || REGULATED_TIERS.has(t)) {
    throw new HttpsError(
      "failed-precondition",
      "Regulated documents (W-4, W-9, I-9, and similar) cannot use Fair Flow generic e-sign library."
    );
  }
  return t;
}

/**
 * Mirror firestore canManageOnboardingSettings:
 * ownerUid / admin|owner role / settings_manage on staff doc.
 */
async function assertCanManageOnboardingSettings(uid, salonId) {
  const [userSnap, salonSnap, memberSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
  ]);
  if (!salonSnap.exists) throw new HttpsError("not-found", "Salon not found.");
  if (salonSnap.get("ownerUid") === uid) return { role: "owner" };

  const u = userSnap.exists ? userSnap.data() || {} : {};
  const userRole = trimStr(u.role).toLowerCase();
  if (
    trimStr(u.salonId) === salonId &&
    (userRole === "owner" || userRole === "admin")
  ) {
    return { role: userRole };
  }

  const m = memberSnap.exists ? memberSnap.data() || {} : {};
  const memberRole = trimStr(m.role).toLowerCase();
  if (memberRole === "owner" || memberRole === "admin") {
    return { role: memberRole };
  }

  const staffId = trimStr(u.staffId) || trimStr(m.staffId);
  if (trimStr(u.salonId) === salonId && staffId) {
    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    if (staffSnap.exists) {
      const perms = (staffSnap.data() || {}).permissions || {};
      if (perms.settings_manage === true) {
        return { role: userRole || memberRole || "staff", settingsManage: true };
      }
      const staffRole = trimStr(staffSnap.get("role")).toLowerCase();
      if (staffRole === "owner" || staffRole === "admin") {
        return { role: staffRole };
      }
    }
  }

  throw new HttpsError(
    "permission-denied",
    "Only owners/admins or staff with settings_manage can manage the signature library."
  );
}

function docsCol(salonId) {
  return db().collection(`salons/${salonId}/onboardingSignatureDocuments`);
}

function docRef(salonId, documentId) {
  return docsCol(salonId).doc(documentId);
}

function versionsCol(salonId, documentId) {
  return docRef(salonId, documentId).collection("versions");
}

function isPdfMagic(buf) {
  if (!buf || buf.length < 5) return false;
  return (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ); // %PDF-
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function countPdfPages(buf) {
  const pdf = await PDFDocument.load(buf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return pdf.getPageCount();
}

function safeFileName(name) {
  return String(name || "document.pdf")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 80);
}

function clamp01(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Normalize + validate fieldSchema for E2.
 * Coordinates are normalized 0–1 page-relative (x,y,width,height).
 * signerRole is always employee in v1 (no countersign).
 */
function normalizeAndValidateFieldSchema(raw, pageCount) {
  if (!Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "fieldSchema must be an array.");
  }
  if (raw.length > MAX_FIELDS) {
    throw new HttpsError(
      "invalid-argument",
      `fieldSchema supports at most ${MAX_FIELDS} fields.`
    );
  }
  const pages = Number(pageCount) || 0;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i] && typeof raw[i] === "object" ? raw[i] : null;
    if (!f) {
      throw new HttpsError("invalid-argument", `fieldSchema[${i}] is invalid.`);
    }
    const type = trimStr(f.type).toLowerCase();
    if (!FIELD_TYPES.has(type)) {
      throw new HttpsError(
        "invalid-argument",
        `Unsupported field type "${type}". Allowed: ${[...FIELD_TYPES].join(", ")}.`
      );
    }
    const id = trimStr(f.id) || `fld_${i + 1}_${type}`;
    if (seen.has(id)) {
      throw new HttpsError("invalid-argument", `Duplicate field id "${id}".`);
    }
    seen.add(id);
    const page = Math.floor(Number(f.page));
    if (!(page >= 1) || (pages > 0 && page > pages)) {
      throw new HttpsError(
        "invalid-argument",
        `Field "${id}" page must be between 1 and ${pages || "pageCount"}.`
      );
    }
    // Accept either flat x/y/width/height or rect.{x,y,w,h}
    const rect = f.rect && typeof f.rect === "object" ? f.rect : null;
    let x = clamp01(rect ? rect.x : f.x, NaN);
    let y = clamp01(rect ? rect.y : f.y, NaN);
    let width = clamp01(rect ? rect.w ?? rect.width : f.width, NaN);
    let height = clamp01(rect ? rect.h ?? rect.height : f.height, NaN);
    if (![x, y, width, height].every((n) => Number.isFinite(n))) {
      throw new HttpsError(
        "invalid-argument",
        `Field "${id}" requires normalized x/y/width/height (0–1).`
      );
    }
    if (width <= 0 || height <= 0) {
      throw new HttpsError(
        "invalid-argument",
        `Field "${id}" width/height must be > 0.`
      );
    }
    if (x + width > 1.0001 || y + height > 1.0001) {
      // Soft-clamp into page
      width = Math.min(width, 1 - x);
      height = Math.min(height, 1 - y);
    }
    const signerRole = trimStr(f.signerRole).toLowerCase() || "employee";
    if (signerRole !== "employee") {
      throw new HttpsError(
        "invalid-argument",
        "Only signerRole=employee is supported in v1 (no countersign)."
      );
    }
    out.push({
      id,
      type,
      page,
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
      width: Number(width.toFixed(6)),
      height: Number(height.toFixed(6)),
      required: f.required === true,
      label: trimStr(f.label) || type.replace(/_/g, " "),
      signerRole: "employee",
    });
  }
  return out;
}

function versionIsImmutable(ver) {
  return (
    ver &&
    (ver.schemaFrozen === true ||
      ver.immutable === true ||
      Number(ver.boundRunCount || 0) > 0)
  );
}

// ─── Callables ───────────────────────────────────────────────────────────────

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
    const storagePath = `salons/${salonId}/onboarding-signature-library/${documentId}/${versionId}/source.pdf`;
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

    const bucket = await resolveBucket();
    const file = bucket.file(storagePath);
    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + UPLOAD_URL_TTL_MS,
      contentType: PDF_MIME,
    });

    return {
      documentId,
      versionId,
      uploadUrl,
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

exports.getOnboardingSignatureDocumentVersionReadUrl = onCall(
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
    const [readUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresMs,
    });

    return {
      documentId,
      versionId,
      readUrl,
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
