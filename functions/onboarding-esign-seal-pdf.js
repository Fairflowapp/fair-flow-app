/**
 * Employee Onboarding E-Sign seal — PDF overlay, certificate, audit, staff docs.
 */
const {
  admin,
  PDFDocument,
  rgb,
  StandardFonts,
  HttpsError,
  db,
  trimStr,
  sha256Buffer,
  resolveBucket,
  documentIds,
} = require("./onboarding-esign-seal-helpers");

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

module.exports = {
  downloadSourcePdf,
  overlaySignedPdf,
  buildCertificatePdf,
  writeAudit,
  upsertStaffDocument,
};
