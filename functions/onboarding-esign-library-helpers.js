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
/** Short-lived signed read URLs — security contract: 5 minutes. */
const READ_URL_TTL_MS = 5 * 60 * 1000;
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
    // S3: sensitive flag only on text fields (UI + server).
    let sensitive = f.sensitive === true;
    let sensitiveKind = trimStr(f.sensitiveKind).toLowerCase() || "";
    if (sensitive && type !== "text") {
      throw new HttpsError(
        "invalid-argument",
        `Field "${id}": sensitive is only allowed on text fields.`
      );
    }
    if (!sensitive) {
      sensitiveKind = "";
    } else if (
      sensitiveKind &&
      !["ssn", "bank_account", "other"].includes(sensitiveKind)
    ) {
      throw new HttpsError(
        "invalid-argument",
        `Field "${id}": unsupported sensitiveKind "${sensitiveKind}".`
      );
    } else if (!sensitiveKind) {
      sensitiveKind = "other";
    }
    const entry = {
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
    };
    if (sensitive) {
      entry.sensitive = true;
      entry.sensitiveKind = sensitiveKind;
    }
    out.push(entry);
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

module.exports = {
  crypto,
  admin,
  PDFDocument,
  onCall,
  HttpsError,
  REGION,
  UPLOAD_URL_TTL_MS,
  MAX_SIZE_BYTES,
  MAX_PAGES,
  PDF_MIME,
  READ_URL_TTL_MS,
  MAX_FIELDS,
  FIELD_TYPES,
  REGULATED_TIERS,
  db,
  trimStr,
  requireAuth,
  resolveBucket,
  normalizeComplianceTier,
  assertStandardTier,
  assertCanManageOnboardingSettings,
  docsCol,
  docRef,
  versionsCol,
  isPdfMagic,
  sha256Buffer,
  countPdfPages,
  safeFileName,
  clamp01,
  normalizeAndValidateFieldSchema,
  versionIsImmutable,
};
