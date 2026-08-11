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
const PACKET_URL_TTL_MS = 15 * 60 * 1000;

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

function sealIdFor(taskId, documentVersionId) {
  return `seal_${trimStr(taskId)}_${trimStr(documentVersionId)}`;
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
  return schema.slice(0, 100).map((f) => ({
    id: trimStr(f.id),
    type: trimStr(f.type),
    page: Number(f.page) || 1,
    x: Number(f.x) || 0,
    y: Number(f.y) || 0,
    width: Number(f.width) || 0.1,
    height: Number(f.height) || 0.05,
    required: f.required === true,
    label: trimStr(f.label) || trimStr(f.type),
    signerRole: "employee",
  }));
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

async function downloadSourcePdf(salonId, cfg) {
  const { documentId, documentVersionId } = documentIds(cfg);
  const expectedSha = trimStr(cfg.documentSha256);
  if (!documentId || !documentVersionId || !expectedSha) {
    throw new HttpsError(
      "failed-precondition",
      "Task snapshot is missing document bind data."
    );
  }

  // Prefer snapshot storage path if present; else library convention
  let storagePath = trimStr(cfg.storagePath);
  if (!storagePath) {
    storagePath = `salons/${salonId}/onboarding-signature-library/${documentId}/${documentVersionId}/source.pdf`;
  }

  const bucket = await resolveBucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("failed-precondition", "Source PDF is missing.");
  }
  const [buf] = await file.download();
  const sha = sha256Buffer(buf);
  if (sha !== expectedSha) {
    throw new HttpsError(
      "failed-precondition",
      "Document hash mismatch — signing blocked (version_mismatch)."
    );
  }
  return { buf, sha, storagePath, documentId, documentVersionId };
}

async function overlaySignedPdf(sourceBuf, validated) {
  const pdf = await PDFDocument.load(sourceBuf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let sigImage = null;
  if (validated.signaturePng) {
    try {
      if (validated.signaturePng[0] === 0xff) {
        sigImage = await pdf.embedJpg(validated.signaturePng);
      } else {
        sigImage = await pdf.embedPng(validated.signaturePng);
      }
    } catch (e) {
      throw new HttpsError(
        "invalid-argument",
        "Could not embed signature image."
      );
    }
  }

  const pages = pdf.getPages();
  for (const f of validated.schema) {
    const pageIndex = Math.max(0, (Number(f.page) || 1) - 1);
    if (pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { width: pw, height: ph } = page.getSize();
    const x = Number(f.x) * pw;
    const w = Number(f.width) * pw;
    const h = Number(f.height) * ph;
    const yTop = Number(f.y) * ph;
    const y = ph - yTop - h; // PDF origin bottom-left

    if (f.type === "signature") {
      if (sigImage) {
        page.drawImage(sigImage, { x, y, width: w, height: h });
      } else if (validated.typedName) {
        page.drawText(validated.typedName.slice(0, 80), {
          x: x + 2,
          y: y + h * 0.35,
          size: Math.min(14, h * 0.55),
          font: fontBold,
          color: rgb(0.05, 0.1, 0.25),
        });
      }
      continue;
    }
    if (f.type === "checkbox") {
      const on = validated.fieldValues[f.id] === true;
      page.drawRectangle({
        x,
        y,
        width: Math.min(w, h),
        height: Math.min(w, h),
        borderWidth: 1,
        borderColor: rgb(0.15, 0.15, 0.2),
        color: rgb(1, 1, 1),
      });
      if (on) {
        page.drawText("X", {
          x: x + 2,
          y: y + 2,
          size: Math.min(w, h) * 0.75,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
      continue;
    }
    let text = trimStr(validated.fieldValues[f.id]);
    if (f.type === "typed_name" && !text) text = validated.typedName;
    if (!text) continue;
    page.drawText(text.slice(0, 200), {
      x: x + 2,
      y: y + Math.max(2, h * 0.3),
      size: Math.min(12, h * 0.55),
      font,
      color: rgb(0.1, 0.1, 0.15),
      maxWidth: Math.max(8, w - 4),
    });
  }

  pdf.setTitle("Fair Flow — Electronically Signed");
  pdf.setProducer("Fair Flow Onboarding E-Sign");
  return Buffer.from(await pdf.save());
}

async function buildCertificatePdf(meta) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const left = 48;
  const line = (text, opts = {}) => {
    const size = opts.size || 10;
    const f = opts.bold ? fontBold : font;
    const chunk = String(text || "").slice(0, 95);
    if (y < 48) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    page.drawText(chunk, {
      x: left,
      y,
      size,
      font: f,
      color: rgb(0.1, 0.1, 0.15),
    });
    y -= opts.gap || 14;
  };

  line("Fair Flow — Electronic Signature Certificate", { bold: true, size: 14, gap: 22 });
  line("This document is evidence of an electronic signature collected via the");
  line("Fair Flow Employee Onboarding Portal. It is not a substitute for counsel");
  line("review of applicable e-sign statutes.", { gap: 20 });

  const rows = [
    ["Salon ID", meta.salonId],
    ["Staff ID", meta.staffId],
    ["Signer name", meta.signerName],
    ["Signer email", meta.signerEmail],
    ["Signed at (UTC)", meta.signedAtIso],
    ["Signature method", meta.signatureMethod],
    ["Run ID", meta.runId],
    ["Task ID", meta.taskId],
    ["Seal ID", meta.sealId],
    ["Document title", meta.documentTitle],
    ["Document version", String(meta.documentVersion)],
    ["Document version ID", meta.documentVersionId],
    ["Original SHA-256", meta.sourceSha256],
    ["Signed PDF SHA-256", meta.signedPdfSha256],
    ["Certificate SHA-256", "(self — computed after save)"],
    ["IP address", meta.ip],
    ["User-Agent", meta.userAgent],
    ["Portal token ID", meta.portalTokenId],
    ["Consent hash", meta.consentHash],
    ["Field values hash", meta.fieldValuesHash],
  ];
  for (const [k, v] of rows) {
    line(`${k}:`, { bold: true, gap: 12 });
    line(`  ${v == null || v === "" ? "—" : v}`, { gap: 16 });
  }
  line("Consent text:", { bold: true, gap: 12 });
  const consent = String(meta.consentText || "");
  for (let i = 0; i < consent.length; i += 90) {
    line(`  ${consent.slice(i, i + 90)}`);
  }

  return Buffer.from(await pdf.save());
}

async function writeAudit(salonId, staffId, runId, taskId, eventId, data) {
  const ref = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks/${taskId}/signatureAudit/${eventId}`
  );
  await ref.set(
    {
      ...data,
      at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return eventId;
}

async function upsertStaffDocument(salonId, staffId, documentId, payload) {
  const ref = db().doc(
    `salons/${salonId}/staff/${staffId}/documents/${documentId}`
  );
  const snap = await ref.get();
  if (snap.exists) {
    // Idempotent: do not overwrite sealed registry row if already present
    const prev = snap.data() || {};
    if (prev.via === "portal_esign" && prev.storagePath === payload.storagePath) {
      return { documentId, created: false };
    }
  }
  await ref.set(
    {
      ...payload,
      createdAt: snap.exists
        ? snap.get("createdAt") || admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { documentId, created: !snap.exists };
}

/**
 * Full seal pipeline. Caller must have already moved task → sealing (or handle race).
 * Never marks task completed if seal fails mid-way.
 */
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
