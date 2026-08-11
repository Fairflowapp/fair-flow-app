/**
 * Employee Onboarding — Task Type Registry.
 * Stage A types + Phase E0 electronic_signature (config/validation/guards only).
 */

const V1_TASK_TYPES = [
  "document",
  "file_upload",
  "policy_acknowledgement",
  "electronic_signature",
];

/** Compliance tiers for e-sign documents / task config. */
const ESIGN_COMPLIANCE_TIERS = [
  "standard",
  "regulated_tax",
  "regulated_i9",
  "regulated_other",
];

const ESIGN_REGULATED_TIERS = new Set([
  "regulated_tax",
  "regulated_i9",
  "regulated_other",
]);

const ESIGN_MAX_SIZE_MB = 20;
const ESIGN_MAX_PAGES = 50;

const DEFAULT_ESIGN_CONSENT =
  "I agree that my electronic signature is the legal equivalent of my handwritten signature on this document.";

function _asBool(v, fallback) {
  if (v === true || v === false) return v;
  return fallback;
}

function _asString(v, fallback) {
  if (typeof v === "string") return v;
  return fallback;
}

function _asNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function _asStringArray(v, fallback) {
  if (!Array.isArray(v)) return fallback.slice();
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function _baseField(name, label, type, opts) {
  return { name, label, type, ...(opts || {}) };
}

function _ok() {
  return { ok: true, errors: [] };
}

function _fail(errors) {
  return { ok: false, errors: Array.isArray(errors) ? errors : [String(errors || "Invalid config")] };
}

function _normalizeDocumentConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    requiresExpiration: _asBool(c.requiresExpiration, false),
    allowEmployeeUpload: _asBool(c.allowEmployeeUpload, true),
    allowManagerUpload: _asBool(c.allowManagerUpload, true),
    requiresApproval: _asBool(c.requiresApproval, true),
    acceptedMime: _asStringArray(c.acceptedMime, ["application/pdf", "image/*"]),
    maxSizeMb: _asNumber(c.maxSizeMb, 10),
  };
}

function _normalizeFileUploadConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const storeInDocuments = _asBool(c.storeInDocuments, true);
  return {
    storeInDocuments,
    requiresExpiration: _asBool(c.requiresExpiration, false),
    allowEmployeeUpload: _asBool(c.allowEmployeeUpload, true),
    allowManagerUpload: _asBool(c.allowManagerUpload, true),
    requiresApproval: _asBool(
      c.requiresApproval,
      storeInDocuments ? true : false
    ),
    acceptedMime: _asStringArray(c.acceptedMime, ["application/pdf", "image/*"]),
    maxSizeMb: _asNumber(c.maxSizeMb, 10),
  };
}

function _normalizePolicyConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    bodyHtml: _asString(c.bodyHtml, ""),
    version: _asString(c.version, "1.0").trim() || "1.0",
    requireScrollToEnd: _asBool(c.requireScrollToEnd, false),
    requireTypedName: _asBool(c.requireTypedName, false),
  };
}

function _normalizeComplianceTier(raw) {
  const t = _asString(raw, "standard").trim().toLowerCase() || "standard";
  return ESIGN_COMPLIANCE_TIERS.indexOf(t) >= 0 ? t : "standard";
}

const ESIGN_FIELD_TYPES = [
  "signature",
  "typed_name",
  "date",
  "initials",
  "text",
  "checkbox",
];

function _clamp01(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Normalize fieldSchema entries (E2). Coords are page-relative 0–1. */
export function ffNormalizeOnboardingEsignFieldSchema(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.slice(0, 100).forEach((f, i) => {
    if (!f || typeof f !== "object") return;
    const type = _asString(f.type, "").trim().toLowerCase();
    if (ESIGN_FIELD_TYPES.indexOf(type) === -1) return;
    const rect = f.rect && typeof f.rect === "object" ? f.rect : null;
    const x = _clamp01(rect ? rect.x : f.x, 0.1);
    const y = _clamp01(rect ? rect.y : f.y, 0.1);
    let width = _clamp01(rect ? rect.w ?? rect.width : f.width, 0.3);
    let height = _clamp01(rect ? rect.h ?? rect.height : f.height, 0.05);
    if (width <= 0) width = 0.3;
    if (height <= 0) height = 0.05;
    if (x + width > 1) width = Math.max(0.01, 1 - x);
    if (y + height > 1) height = Math.max(0.01, 1 - y);
    const page = Math.max(1, Math.floor(Number(f.page) || 1));
    out.push({
      id: _asString(f.id, "").trim() || `fld_${i + 1}_${type}`,
      type,
      page,
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
      width: Number(width.toFixed(6)),
      height: Number(height.toFixed(6)),
      required: f.required === true,
      label: _asString(f.label, type.replace(/_/g, " ")).trim() || type,
      signerRole: "employee",
    });
  });
  return out;
}

export function ffValidateOnboardingEsignFieldSchema(raw, opts) {
  const fields = ffNormalizeOnboardingEsignFieldSchema(raw);
  const errors = [];
  const pageCount = opts && Number(opts.pageCount) > 0 ? Number(opts.pageCount) : null;
  const requireSignature = !opts || opts.requireSignature !== false;
  if (!fields.length) {
    errors.push("fieldSchema must include at least one field");
  }
  if (requireSignature && !fields.some((f) => f.type === "signature")) {
    errors.push("fieldSchema must include at least one signature field");
  }
  const ids = new Set();
  fields.forEach((f) => {
    if (ids.has(f.id)) errors.push(`Duplicate field id "${f.id}"`);
    ids.add(f.id);
    if (pageCount && f.page > pageCount) {
      errors.push(`Field "${f.id}" page ${f.page} exceeds document pages (${pageCount})`);
    }
    if (f.signerRole !== "employee") {
      errors.push("Only signerRole=employee is supported in v1");
    }
  });
  return errors.length ? _fail(errors) : _ok();
}

/**
 * Normalize electronic_signature task template / run config (E0–E2).
 */
function _normalizeEsignConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const complianceTier = _normalizeComplianceTier(c.complianceTier);
  const regulated = ESIGN_REGULATED_TIERS.has(complianceTier);
  // Regulated tiers can never use generic internal e-sign in v1.
  const allowInternalEsign = regulated
    ? false
    : _asBool(c.allowInternalEsign, true);

  const signatureDocumentId = _asString(
    c.signatureDocumentId || c.documentId,
    ""
  ).trim();
  const signatureDocumentVersionId = _asString(
    c.signatureDocumentVersionId || c.documentVersionId,
    ""
  ).trim();
  const documentVersion =
    c.documentVersion != null && String(c.documentVersion).trim() !== ""
      ? c.documentVersion
      : null;
  const documentSha256 = _asString(c.documentSha256, "").trim();
  const documentTitle = _asString(c.documentTitle, "").trim();
  const fieldSchema = ffNormalizeOnboardingEsignFieldSchema(c.fieldSchema);

  return {
    // Canonical E2 keys + aliases kept for older templates
    signatureDocumentId,
    signatureDocumentVersionId,
    documentId: signatureDocumentId,
    documentVersionId: signatureDocumentVersionId,
    documentVersion,
    documentSha256,
    documentTitle,
    pageCount:
      Number.isFinite(Number(c.pageCount)) && Number(c.pageCount) > 0
        ? Number(c.pageCount)
        : null,
    complianceTier,
    allowInternalEsign,
    requireTypedName: _asBool(c.requireTypedName, false),
    requireDrawnSignature: _asBool(c.requireDrawnSignature, true),
    consentText:
      _asString(c.consentText, DEFAULT_ESIGN_CONSENT).trim() ||
      DEFAULT_ESIGN_CONSENT,
    maxSizeMb: Math.min(
      ESIGN_MAX_SIZE_MB,
      _asNumber(c.maxSizeMb, ESIGN_MAX_SIZE_MB)
    ),
    maxPages: Math.min(ESIGN_MAX_PAGES, _asNumber(c.maxPages, ESIGN_MAX_PAGES)),
    fieldSchema,
    // Explicitly no countersign in v1
    requiresManagerCountersign: false,
  };
}

function _validateMimeAndSize(config) {
  const errors = [];
  if (!Array.isArray(config.acceptedMime) || config.acceptedMime.length === 0) {
    errors.push("acceptedMime must include at least one type");
  }
  if (!(config.maxSizeMb > 0 && config.maxSizeMb <= 50)) {
    errors.push("maxSizeMb must be between 1 and 50");
  }
  return errors;
}

function _validateEsignConfig(config) {
  const c = _normalizeEsignConfig(config);
  const errors = [];

  if (ESIGN_REGULATED_TIERS.has(c.complianceTier)) {
    errors.push(
      "Regulated documents (W-4, W-9, I-9, and similar) cannot use Fair Flow generic e-sign. Use a separate regulated flow when available."
    );
  }
  if (c.allowInternalEsign !== true) {
    errors.push("allowInternalEsign must be true for generic e-sign templates");
  }
  if (!(c.maxSizeMb > 0 && c.maxSizeMb <= ESIGN_MAX_SIZE_MB)) {
    errors.push(`maxSizeMb must be between 1 and ${ESIGN_MAX_SIZE_MB}`);
  }
  if (!(c.maxPages > 0 && c.maxPages <= ESIGN_MAX_PAGES)) {
    errors.push(`maxPages must be between 1 and ${ESIGN_MAX_PAGES}`);
  }
  if (!c.consentText || !String(c.consentText).trim()) {
    errors.push("consentText is required");
  }
  if (c.requireDrawnSignature !== true && c.requireTypedName !== true) {
    errors.push("At least one of requireDrawnSignature or requireTypedName must be true");
  }
  if (c.requiresManagerCountersign === true) {
    errors.push("Manager countersign is not supported in v1");
  }
  if (!Array.isArray(c.fieldSchema)) {
    errors.push("fieldSchema must be an array");
  }
  // Template may be drafted before fields exist; when a document/version is
  // linked, require a usable layout (enforced again at Run create).
  if (c.signatureDocumentId || c.signatureDocumentVersionId) {
    if (!c.signatureDocumentId) {
      errors.push("signatureDocumentId is required when linking a library document");
    }
    if (!c.signatureDocumentVersionId) {
      errors.push("signatureDocumentVersionId is required when linking a library document");
    }
    if (c.fieldSchema.length) {
      const fs = ffValidateOnboardingEsignFieldSchema(c.fieldSchema, {
        pageCount: c.pageCount,
        requireSignature: c.requireDrawnSignature === true,
      });
      if (!fs.ok) errors.push(...fs.errors);
    } else {
      errors.push("fieldSchema is required — place fields on the PDF version first");
    }
    if (!c.documentSha256) {
      errors.push("documentSha256 is required when linking a library document");
    }
  }

  return errors.length ? _fail(errors) : _ok();
}

const documentHandler = {
  taskType: "document",
  getDefaultConfig() {
    return _normalizeDocumentConfig({});
  },
  validateConfig(config) {
    const c = _normalizeDocumentConfig(config);
    const errors = _validateMimeAndSize(c);
    if (!c.allowEmployeeUpload && !c.allowManagerUpload) {
      errors.push("At least one of allowEmployeeUpload or allowManagerUpload must be true");
    }
    return errors.length ? _fail(errors) : _ok();
  },
  getConfigFields() {
    return [
      _baseField("requiresExpiration", "Requires expiration date", "boolean"),
      _baseField("allowEmployeeUpload", "Allow employee upload", "boolean"),
      _baseField("allowManagerUpload", "Allow manager upload", "boolean"),
      _baseField("requiresApproval", "Requires manager approval", "boolean"),
      _baseField("acceptedMime", "Accepted MIME types", "string_list", {
        help: "Comma-separated, e.g. application/pdf, image/*",
      }),
      _baseField("maxSizeMb", "Max file size (MB)", "number"),
    ];
  },
  writesToDocuments() {
    return true;
  },
  supportsReminder() {
    return true;
  },
  normalizeConfig: _normalizeDocumentConfig,
};

const fileUploadHandler = {
  taskType: "file_upload",
  getDefaultConfig() {
    return _normalizeFileUploadConfig({});
  },
  validateConfig(config) {
    const c = _normalizeFileUploadConfig(config);
    const errors = _validateMimeAndSize(c);
    if (!c.allowEmployeeUpload && !c.allowManagerUpload) {
      errors.push("At least one of allowEmployeeUpload or allowManagerUpload must be true");
    }
    return errors.length ? _fail(errors) : _ok();
  },
  getConfigFields() {
    return [
      _baseField("storeInDocuments", "Store completed file in Documents tab", "boolean"),
      _baseField("requiresExpiration", "Requires expiration date", "boolean"),
      _baseField("allowEmployeeUpload", "Allow employee upload", "boolean"),
      _baseField("allowManagerUpload", "Allow manager upload", "boolean"),
      _baseField("requiresApproval", "Requires manager approval", "boolean"),
      _baseField("acceptedMime", "Accepted MIME types", "string_list"),
      _baseField("maxSizeMb", "Max file size (MB)", "number"),
    ];
  },
  writesToDocuments(taskOrConfig) {
    const cfg =
      taskOrConfig && taskOrConfig.configSnapshot
        ? taskOrConfig.configSnapshot
        : taskOrConfig && taskOrConfig.config
          ? taskOrConfig.config
          : taskOrConfig;
    return _normalizeFileUploadConfig(cfg).storeInDocuments === true;
  },
  supportsReminder() {
    return true;
  },
  normalizeConfig: _normalizeFileUploadConfig,
};

const policyAckHandler = {
  taskType: "policy_acknowledgement",
  getDefaultConfig() {
    return _normalizePolicyConfig({});
  },
  validateConfig(config) {
    const c = _normalizePolicyConfig(config);
    const errors = [];
    if (!c.bodyHtml || !String(c.bodyHtml).trim()) {
      errors.push("bodyHtml is required");
    }
    if (!c.version || !String(c.version).trim()) {
      errors.push("version is required");
    }
    return errors.length ? _fail(errors) : _ok();
  },
  getConfigFields() {
    return [
      _baseField("bodyHtml", "Policy text (HTML)", "html"),
      _baseField("version", "Policy version", "string"),
      _baseField("requireScrollToEnd", "Require scroll to end", "boolean"),
      _baseField("requireTypedName", "Require typed full name", "boolean"),
    ];
  },
  writesToDocuments() {
    return false;
  },
  supportsReminder() {
    return true;
  },
  normalizeConfig: _normalizePolicyConfig,
};

const electronicSignatureHandler = {
  taskType: "electronic_signature",
  getDefaultConfig() {
    return _normalizeEsignConfig({});
  },
  validateConfig(config) {
    return _validateEsignConfig(config);
  },
  getConfigFields() {
    return [
      _baseField("complianceTier", "Document classification", "select", {
        options: [
          { value: "standard", label: "Standard (NDA, handbook, policies, agreements)" },
          {
            value: "regulated_tax",
            label: "Regulated tax (W-4, W-9, …) — blocked",
          },
          { value: "regulated_i9", label: "Regulated I-9 — blocked" },
          { value: "regulated_other", label: "Other regulated — blocked" },
        ],
        help: "Only Standard can use Fair Flow generic e-sign in v1. W-4 / W-9 / I-9 are blocked.",
      }),
      _baseField(
        "signatureDocumentId",
        "Signature document (library)",
        "esign_document",
        {
          help: "Pick a Signature Library document + version with a saved field layout.",
        }
      ),
      _baseField("requireDrawnSignature", "Require drawn signature", "boolean"),
      _baseField("requireTypedName", "Require typed full name", "boolean"),
      _baseField("consentText", "Consent text", "html"),
      _baseField("maxSizeMb", "Max PDF size (MB)", "number", {
        help: `Maximum ${ESIGN_MAX_SIZE_MB} MB`,
      }),
      _baseField("maxPages", "Max PDF pages", "number", {
        help: `Maximum ${ESIGN_MAX_PAGES} pages`,
      }),
    ];
  },
  writesToDocuments() {
    return true;
  },
  supportsReminder() {
    return true;
  },
  normalizeConfig: _normalizeEsignConfig,
};

const HANDLERS = {
  document: documentHandler,
  file_upload: fileUploadHandler,
  policy_acknowledgement: policyAckHandler,
  electronic_signature: electronicSignatureHandler,
};

export function ffOnboardingV1TaskTypes() {
  return V1_TASK_TYPES.slice();
}

export function ffOnboardingEsignComplianceTiers() {
  return ESIGN_COMPLIANCE_TIERS.slice();
}

export function ffOnboardingEsignIsRegulatedTier(tier) {
  return ESIGN_REGULATED_TIERS.has(
    String(tier || "")
      .trim()
      .toLowerCase()
  );
}

/** True only when generic internal e-sign is allowed for this config. */
export function ffOnboardingEsignAllowsInternalSign(config) {
  const c = _normalizeEsignConfig(config);
  return (
    c.complianceTier === "standard" &&
    c.allowInternalEsign === true &&
    !ESIGN_REGULATED_TIERS.has(c.complianceTier)
  );
}

export function ffOnboardingEsignLimits() {
  return { maxSizeMb: ESIGN_MAX_SIZE_MB, maxPages: ESIGN_MAX_PAGES };
}

export function ffOnboardingEsignFieldTypes() {
  return ESIGN_FIELD_TYPES.slice();
}

export function ffGetOnboardingTaskHandler(taskType) {
  const key = String(taskType || "").trim();
  return HANDLERS[key] || null;
}

export function ffNormalizeOnboardingTaskConfig(taskType, config) {
  const handler = ffGetOnboardingTaskHandler(taskType);
  if (!handler || typeof handler.normalizeConfig !== "function") {
    return config && typeof config === "object" ? { ...config } : {};
  }
  return handler.normalizeConfig(config);
}

export function ffValidateOnboardingTaskConfig(taskType, config) {
  const handler = ffGetOnboardingTaskHandler(taskType);
  if (!handler) return _fail(`Unsupported task type: ${taskType}`);
  return handler.validateConfig(config);
}

export function ffOnboardingTaskTypeLabel(taskType) {
  const map = {
    document: "Document",
    file_upload: "File upload",
    policy_acknowledgement: "Policy acknowledgement",
    electronic_signature: "Electronic signature",
  };
  return map[String(taskType || "").trim()] || String(taskType || "");
}

if (typeof window !== "undefined") {
  window.ffOnboardingV1TaskTypes = ffOnboardingV1TaskTypes;
  window.ffGetOnboardingTaskHandler = ffGetOnboardingTaskHandler;
  window.ffNormalizeOnboardingTaskConfig = ffNormalizeOnboardingTaskConfig;
  window.ffValidateOnboardingTaskConfig = ffValidateOnboardingTaskConfig;
  window.ffOnboardingTaskTypeLabel = ffOnboardingTaskTypeLabel;
  window.ffOnboardingEsignComplianceTiers = ffOnboardingEsignComplianceTiers;
  window.ffOnboardingEsignIsRegulatedTier = ffOnboardingEsignIsRegulatedTier;
  window.ffOnboardingEsignAllowsInternalSign = ffOnboardingEsignAllowsInternalSign;
  window.ffOnboardingEsignLimits = ffOnboardingEsignLimits;
  window.ffOnboardingEsignFieldTypes = ffOnboardingEsignFieldTypes;
  window.ffNormalizeOnboardingEsignFieldSchema = ffNormalizeOnboardingEsignFieldSchema;
  window.ffValidateOnboardingEsignFieldSchema = ffValidateOnboardingEsignFieldSchema;
}
