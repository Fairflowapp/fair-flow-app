/**
 * Employee Onboarding S5 — shared helpers for catalog + run write callables.
 */
const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  db,
  trimStr,
  requireAuth,
  assertCanManageOnboardingSettings,
  normalizeComplianceTier,
  REGULATED_TIERS,
} = require("./onboarding-esign-library-helpers");
const { assertManager } = require("./onboarding-portal-shared-core");

const REGION = "us-central1";
const V1_TYPES = [
  "document",
  "file_upload",
  "policy_acknowledgement",
  "electronic_signature",
];
const DEFAULT_ESIGN_CONSENT =
  "I agree that my electronic signature is the legal equivalent of my handwritten signature on this document.";

if (!admin.apps.length) admin.initializeApp();

function nameToId(name) {
  const s = trimStr(name).toLowerCase();
  if (!s) return "";
  const latin = s
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (latin) return latin;
  const unicode = s
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return unicode || "";
}

async function uniqueDocId(col, base) {
  let id = base || `id_${Date.now()}`;
  let n = 1;
  while ((await col.doc(id).get()).exists) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}

function normalizeAudience(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const wc = Array.isArray(src.workerClassifications)
    ? src.workerClassifications
        .map((x) => trimStr(x).toLowerCase())
        .filter((s) => s === "w2" || s === "1099")
    : [];
  const seen = new Set();
  const technicianTypeIds = [];
  for (const rawId of Array.isArray(src.technicianTypeIds)
    ? src.technicianTypeIds
    : []) {
    const id = trimStr(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    technicianTypeIds.push(id);
  }
  return { workerClassifications: [...new Set(wc)], technicianTypeIds };
}

function asBool(v, fallback) {
  if (v === true || v === false) return v;
  return fallback;
}

function asNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asMime(v, fallback) {
  if (!Array.isArray(v)) return fallback.slice();
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function normalizeTaskConfig(taskType, raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  if (taskType === "document" || taskType === "file_upload") {
    const storeInDocuments = asBool(
      c.storeInDocuments,
      taskType === "file_upload" ? true : true
    );
    return {
      requiresExpiration: asBool(c.requiresExpiration, true),
      allowEmployeeUpload: asBool(c.allowEmployeeUpload, true),
      allowManagerUpload: asBool(c.allowManagerUpload, true),
      requiresApproval: asBool(
        c.requiresApproval,
        taskType === "file_upload" ? !!storeInDocuments : true
      ),
      acceptedMime: asMime(c.acceptedMime, ["application/pdf", "image/*"]),
      maxSizeMb: Math.min(50, asNum(c.maxSizeMb, 10)),
      ...(taskType === "file_upload" ? { storeInDocuments } : {}),
    };
  }
  if (taskType === "policy_acknowledgement") {
    return {
      bodyHtml: String(c.bodyHtml || ""),
      version: trimStr(c.version) || "1.0",
      requireScrollToEnd: asBool(c.requireScrollToEnd, false),
      requireTypedName: asBool(c.requireTypedName, false),
    };
  }
  if (taskType === "electronic_signature") {
    const complianceTier = normalizeComplianceTier(c.complianceTier);
    if (REGULATED_TIERS.has(complianceTier) || complianceTier !== "standard") {
      throw new HttpsError(
        "failed-precondition",
        "Regulated documents (W-4, W-9, I-9, and similar) cannot use Fair Flow generic e-sign."
      );
    }
    const signatureDocumentId = trimStr(
      c.signatureDocumentId || c.documentId
    );
    const signatureDocumentVersionId = trimStr(
      c.signatureDocumentVersionId || c.documentVersionId
    );
    const fieldSchema = Array.isArray(c.fieldSchema) ? c.fieldSchema : [];
    return {
      signatureDocumentId,
      signatureDocumentVersionId,
      documentId: signatureDocumentId,
      documentVersionId: signatureDocumentVersionId,
      documentVersion: c.documentVersion != null ? c.documentVersion : null,
      documentSha256: trimStr(c.documentSha256),
      documentTitle: trimStr(c.documentTitle),
      pageCount: asNum(c.pageCount, null),
      fieldSchema,
      complianceTier: "standard",
      allowInternalEsign: true,
      requireTypedName: asBool(c.requireTypedName, false),
      requireDrawnSignature: asBool(c.requireDrawnSignature, true),
      consentText: trimStr(c.consentText) || DEFAULT_ESIGN_CONSENT,
      maxSizeMb: Math.min(20, asNum(c.maxSizeMb, 20)),
      maxPages: Math.min(50, asNum(c.maxPages, 50)),
      requiresManagerCountersign: false,
    };
  }
  throw new HttpsError("invalid-argument", `Unsupported taskType "${taskType}".`);
}

function normalizePackageItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it, idx) => {
      if (!it || typeof it !== "object") return null;
      const templateId = trimStr(it.templateId);
      if (!templateId) return null;
      const row = {
        templateId,
        required: it.required === false ? false : true,
        sortOrder: Number.isFinite(Number(it.sortOrder))
          ? Number(it.sortOrder)
          : idx,
      };
      if (it.configOverrides && typeof it.configOverrides === "object") {
        row.configOverrides = it.configOverrides;
      }
      return row;
    })
    .filter(Boolean)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

async function assertCanActOnStaff(uid, salonId, staffId) {
  try {
    return await assertManager(uid, salonId);
  } catch (_) {
    /* fall through to self */
  }
  const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
  if (!staffSnap.exists) throw new HttpsError("not-found", "Staff not found.");
  const s = staffSnap.data() || {};
  if (trimStr(s.uid) === uid || trimStr(s.authUid) === uid) {
    return { role: "self" };
  }
  const userSnap = await db().doc(`users/${uid}`).get();
  const u = userSnap.exists ? userSnap.data() || {} : {};
  if (trimStr(u.salonId) === salonId && trimStr(u.staffId) === staffId) {
    return { role: "self" };
  }
  throw new HttpsError(
    "permission-denied",
    "Only managers or the assigned employee can update this onboarding task."
  );
}

function runRef(salonId, staffId, runId) {
  return db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
}

function taskRef(salonId, staffId, runId, taskId) {
  return db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks/${taskId}`
  );
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

module.exports = {
  admin,
  HttpsError,
  REGION,
  V1_TYPES,
  db,
  trimStr,
  requireAuth,
  assertCanManageOnboardingSettings,
  assertManager,
  nameToId,
  uniqueDocId,
  normalizeAudience,
  normalizeTaskConfig,
  normalizePackageItems,
  assertCanActOnStaff,
  runRef,
  taskRef,
  nowTs,
};
