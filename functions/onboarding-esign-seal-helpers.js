/**
 * Employee Onboarding E-Sign — Phase E3 seal pipeline (packet → submit → seal).
 *
 * Pure helpers used by onboarding-portal HTTP handlers.
 * No Portal Storage permissions for employees — all via Admin SDK / signed URLs.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const { HttpsError } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();

const REGULATED = new Set([
  "regulated_tax",
  "regulated_i9",
  "regulated_other",
]);
/** Portal signature packet PDF preview — align with 5-minute read URL contract. */
const PACKET_URL_TTL_MS = 5 * 60 * 1000;

function db() {
  return admin.firestore();
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256Text(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function sealIdFor(taskId, documentVersionId, staffId, runId) {
  const staff = trimStr(staffId);
  const run = trimStr(runId);
  const base = `${trimStr(taskId)}_${trimStr(documentVersionId)}`;
  // Must be unique per employee + run. Task+version alone reused a test seal
  // across staff (same template id) and attached the wrong signed PDF.
  if (staff && run) return `seal_${staff}_${run}_${base}`;
  return `seal_${base}`;
}

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
          /* next */
        }
      }
      return admin.storage().bucket();
    })();
  }
  return _bucketPromise;
}

function esignCfg(task) {
  return (task && task.configSnapshot) || {};
}

function documentIds(cfg) {
  const documentId = trimStr(cfg.signatureDocumentId || cfg.documentId);
  const documentVersionId = trimStr(
    cfg.signatureDocumentVersionId || cfg.documentVersionId
  );
  return { documentId, documentVersionId };
}

function assertEsignAllowed(cfg) {
  const tier = trimStr(cfg.complianceTier || "standard").toLowerCase() || "standard";
  if (tier !== "standard" || REGULATED.has(tier) || cfg.allowInternalEsign !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Regulated documents cannot use Fair Flow generic e-sign."
    );
  }
  if (cfg.requiresManagerCountersign === true) {
    throw new HttpsError(
      "failed-precondition",
      "Manager countersign is not supported in v1."
    );
  }
}

function publicFieldSchema(schema) {
  if (!Array.isArray(schema)) return [];
  return schema.slice(0, 100).map((f) => {
    const type = trimStr(f.type);
    const entry = {
      id: trimStr(f.id),
      type,
      page: Number(f.page) || 1,
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      width: Number(f.width) || 0.1,
      height: Number(f.height) || 0.05,
      required: f.required === true,
      label: trimStr(f.label) || trimStr(f.type),
      signerRole: "employee",
    };
    // S3: expose sensitive only for text (portal/seal use this snapshot).
    if (type === "text" && f.sensitive === true) {
      entry.sensitive = true;
      const kind = trimStr(f.sensitiveKind).toLowerCase();
      entry.sensitiveKind =
        kind === "ssn" || kind === "bank_account" || kind === "other"
          ? kind
          : "other";
    }
    return entry;
  });
}

function publicEsignResult(result) {
  const r = result && typeof result === "object" ? result : {};
  const out = {};
  for (const k of [
    "sealId",
    "signedAt",
    "signerName",
    "signedPdfSha256",
    "certificateSha256",
    "sourceDocumentSha256",
    "signatureMethod",
    "signedDocumentId",
    "certificateDocumentId",
    "documentVersionId",
    "auditId",
  ]) {
    if (r[k] != null) out[k] = r[k];
  }
  // Explicitly never expose IP / UA on portal DTO
  return out;
}

function decodePngBase64(raw) {
  let s = trimStr(raw);
  if (!s) return null;
  const m = s.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (m) s = m[2];
  const buf = Buffer.from(s, "base64");
  if (buf.length < 32) return null;
  // PNG magic or JPEG magic
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) {
    throw new HttpsError("invalid-argument", "Signature image must be PNG or JPEG.");
  }
  if (buf.length > 1.5 * 1024 * 1024) {
    throw new HttpsError("invalid-argument", "Signature image must be under 1.5 MB.");
  }
  return buf;
}

/**
 * Validate field values + signature against snapshot schema/config.
 * @returns {{ fieldValues: object, signatureMethod: string, typedName: string, signaturePng: Buffer|null, consentText: string }}
 */
function validateEsignSubmission(task, payload) {
  const cfg = esignCfg(task);
  assertEsignAllowed(cfg);
  const schema = publicFieldSchema(cfg.fieldSchema);
  if (!schema.length) {
    throw new HttpsError("failed-precondition", "Task has no field layout.");
  }

  if (payload && payload.consentAccepted !== true) {
    throw new HttpsError("invalid-argument", "Consent is required.");
  }
  const consentText =
    trimStr(payload && payload.consentText) || trimStr(cfg.consentText);
  if (!consentText || consentText !== trimStr(cfg.consentText)) {
    throw new HttpsError(
      "invalid-argument",
      "Consent text does not match the assigned document."
    );
  }

  const rawValues =
    payload && payload.fieldValues && typeof payload.fieldValues === "object"
      ? payload.fieldValues
      : {};
  const fieldValues = {};
  const missing = [];

  for (const f of schema) {
    const v = rawValues[f.id];
    if (f.type === "checkbox") {
      const checked = v === true || v === "true" || v === 1 || v === "1";
      fieldValues[f.id] = checked;
      if (f.required && !checked) missing.push(f.label || f.id);
      continue;
    }
    if (f.type === "signature") {
      // filled via shared signature payload
      fieldValues[f.id] = "__signature__";
      continue;
    }
    const s = trimStr(v);
    fieldValues[f.id] = s;
    if (f.required && !s) missing.push(f.label || f.id);
  }
  if (missing.length) {
    throw new HttpsError(
      "invalid-argument",
      `Missing required fields: ${missing.slice(0, 8).join(", ")}`
    );
  }

  const sigPayload =
    (payload && payload.signature && typeof payload.signature === "object"
      ? payload.signature
      : {}) || {};
  let signatureMethod = trimStr(sigPayload.method).toLowerCase();
  const typedName = trimStr(
    sigPayload.typedName || payload.typedName || fieldValues[
      schema.find((f) => f.type === "typed_name")?.id
    ]
  );
  let signaturePng = null;

  const hasSigField = schema.some((f) => f.type === "signature");
  const requireDrawn = cfg.requireDrawnSignature !== false;
  const requireTyped = cfg.requireTypedName === true;

  if (hasSigField || requireDrawn || requireTyped) {
    if (!signatureMethod) {
      if (sigPayload.pngBase64 || sigPayload.imageBase64) signatureMethod = "drawn";
      else if (typedName) signatureMethod = "typed";
    }
    if (signatureMethod !== "drawn" && signatureMethod !== "typed") {
      throw new HttpsError(
        "invalid-argument",
        "signature.method must be drawn or typed."
      );
    }
    if (signatureMethod === "drawn" || requireDrawn) {
      signaturePng = decodePngBase64(
        sigPayload.pngBase64 || sigPayload.imageBase64
      );
      if (requireDrawn && !signaturePng) {
        throw new HttpsError(
          "invalid-argument",
          "Drawn signature image is required."
        );
      }
      if (signaturePng) signatureMethod = "drawn";
    }
    if (signatureMethod === "typed" || requireTyped) {
      if (!typedName || typedName.length < 2) {
        throw new HttpsError(
          "invalid-argument",
          "Typed full name is required."
        );
      }
      if (!signaturePng) signatureMethod = "typed";
    }
  }

  // Ensure typed_name required fields satisfied by typedName
  for (const f of schema) {
    if (f.type === "typed_name" && f.required) {
      if (!trimStr(fieldValues[f.id]) && typedName) {
        fieldValues[f.id] = typedName;
      }
      if (!trimStr(fieldValues[f.id])) {
        throw new HttpsError(
          "invalid-argument",
          `Missing required field: ${f.label || f.id}`
        );
      }
    }
  }

  return {
    fieldValues,
    signatureMethod: signatureMethod || "typed",
    typedName,
    signaturePng,
    consentText,
    schema,
  };
}

/**
 * S4 — encrypt sensitive text for Firestore; keep plaintext only for PDF overlay.
 * @returns {{
 *   fieldValuesEncrypted: object,
 *   fieldValuesPublic: object,
 *   fieldValuesSafe: object,
 *   sensitiveFieldIds: string[]
 * }}
 */
function partitionEsignFieldValues(schema, fieldValues) {
  const { encryptFieldValue, maskDisplay } = require("./onboarding-crypto");
  const values =
    fieldValues && typeof fieldValues === "object" ? fieldValues : {};
  const fieldValuesEncrypted = {};
  const fieldValuesPublic = {};
  const fieldValuesSafe = { ...values };
  const sensitiveFieldIds = [];

  for (const f of Array.isArray(schema) ? schema : []) {
    const id = trimStr(f.id);
    if (!id) continue;
    const type = trimStr(f.type);
    const label = trimStr(f.label) || id;

    if (type === "checkbox") {
      fieldValuesPublic[id] = {
        type: "checkbox",
        checked: values[id] === true,
        label,
      };
      continue;
    }
    if (type === "signature") {
      fieldValuesPublic[id] = { type: "signature", label };
      continue;
    }

    const raw = values[id];
    const text = trimStr(raw);
    if (type === "text" && f.sensitive === true) {
      if (!text) continue;
      const sensitiveKind =
        trimStr(f.sensitiveKind).toLowerCase() === "ssn" ||
        trimStr(f.sensitiveKind).toLowerCase() === "bank_account"
          ? trimStr(f.sensitiveKind).toLowerCase()
          : "other";
      const envelope = encryptFieldValue(text, { sensitiveKind });
      fieldValuesEncrypted[id] = envelope;
      const displayValue = maskDisplay(envelope.last4, sensitiveKind);
      fieldValuesPublic[id] = {
        type: "text",
        sensitive: true,
        sensitiveKind,
        last4: envelope.last4,
        displayValue,
        label,
      };
      fieldValuesSafe[id] = displayValue;
      sensitiveFieldIds.push(id);
      continue;
    }

    if (text) {
      fieldValuesPublic[id] = {
        type: type || "text",
        sensitive: false,
        displayValue: text.slice(0, 200),
        label,
      };
    }
  }

  return {
    fieldValuesEncrypted,
    fieldValuesPublic,
    fieldValuesSafe,
    sensitiveFieldIds,
  };
}

module.exports = {
  crypto,
  admin,
  PDFDocument,
  rgb,
  StandardFonts,
  HttpsError,
  REGULATED,
  PACKET_URL_TTL_MS,
  db,
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
  decodePngBase64,
  validateEsignSubmission,
  partitionEsignFieldValues,
};
