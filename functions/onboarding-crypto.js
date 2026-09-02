/**
 * Employee Onboarding S2 — field-level encryption (AES-256-GCM).
 *
 * Secret: ONBOARDING_FIELD_ENCRYPTION_KEY (32 bytes, base64 or hex).
 * Loaded only at Cloud Functions runtime via Secret Manager.
 *
 * Emulator / unit tests: set process.env.ONBOARDING_FIELD_ENCRYPTION_KEY.
 */

const crypto = require("crypto");

/** Lazy so unit tests can load this module without firebase-functions installed. */
let ONBOARDING_FIELD_ENCRYPTION_KEY = null;
try {
  const { defineSecret } = require("firebase-functions/params");
  ONBOARDING_FIELD_ENCRYPTION_KEY = defineSecret(
    "ONBOARDING_FIELD_ENCRYPTION_KEY"
  );
} catch (_) {
  ONBOARDING_FIELD_ENCRYPTION_KEY = {
    value() {
      return process.env.ONBOARDING_FIELD_ENCRYPTION_KEY || "";
    },
  };
}

const ALG = "aes-256-gcm";
/** Bump when rotating keys; decrypt must accept prior versions. */
const CURRENT_KEY_VERSION = "v1";

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

/**
 * Resolve 32-byte key from Secret Manager or env.
 * Accepts: base64 (32 bytes), hex (64 chars), or raw 32-char utf8 (dev only).
 */
function resolveKeyBytes(explicit) {
  let raw = trimStr(explicit);
  if (!raw) {
    try {
      raw = trimStr(ONBOARDING_FIELD_ENCRYPTION_KEY.value());
    } catch (_) {
      raw = "";
    }
  }
  if (!raw) {
    raw = trimStr(process.env.ONBOARDING_FIELD_ENCRYPTION_KEY);
  }
  if (!raw) {
    throw new Error("ONBOARDING_FIELD_ENCRYPTION_KEY is not configured");
  }

  // hex
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // base64 → 32 bytes
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch (_) {
    /* fall through */
  }
  // raw utf8 (tests / local only)
  const utf = Buffer.from(raw, "utf8");
  if (utf.length === 32) return utf;

  throw new Error(
    "ONBOARDING_FIELD_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex)"
  );
}

/** Display mask helpers — never store full plaintext in Firestore. */
function computeLast4(plaintext, sensitiveKind) {
  const kind = trimStr(sensitiveKind).toLowerCase() || "other";
  const s = String(plaintext == null ? "" : plaintext);
  if (kind === "ssn") {
    const digits = s.replace(/\D/g, "");
    const last = digits.slice(-4);
    return last.length === 4 ? last : s.slice(-4);
  }
  if (kind === "bank_account") {
    const digits = s.replace(/\D/g, "");
    const last = digits.slice(-4);
    return last.length ? last : s.slice(-4);
  }
  const cleaned = s.replace(/\s+/g, "");
  return cleaned.slice(-4);
}

function maskDisplay(last4, sensitiveKind) {
  const tail = trimStr(last4) || "????";
  const kind = trimStr(sensitiveKind).toLowerCase() || "other";
  if (kind === "ssn") return `***-**-${tail}`;
  if (kind === "bank_account") return `••••${tail}`;
  return `••••${tail}`;
}

/**
 * @returns {{
 *   alg: string,
 *   keyVersion: string,
 *   iv: string,
 *   ciphertext: string,
 *   authTag: string,
 *   last4: string,
 *   sensitiveKind: string
 * }}
 */
function encryptFieldValue(plaintext, opts = {}) {
  const sensitiveKind = trimStr(opts.sensitiveKind) || "other";
  const key = resolveKeyBytes(opts.keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const pt = Buffer.from(String(plaintext == null ? "" : plaintext), "utf8");
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    alg: "AES-256-GCM",
    keyVersion: CURRENT_KEY_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
    last4: computeLast4(plaintext, sensitiveKind),
    sensitiveKind,
  };
}

function decryptFieldValue(blob, opts = {}) {
  if (!blob || typeof blob !== "object") {
    throw new Error("Missing ciphertext blob");
  }
  const alg = trimStr(blob.alg);
  if (alg && alg !== "AES-256-GCM") {
    throw new Error(`Unsupported cipher: ${alg}`);
  }
  const key = resolveKeyBytes(opts.keyMaterial);
  const iv = Buffer.from(String(blob.iv || ""), "base64");
  const ciphertext = Buffer.from(String(blob.ciphertext || ""), "base64");
  const authTag = Buffer.from(String(blob.authTag || ""), "base64");
  if (iv.length !== 12 || !ciphertext.length || authTag.length !== 16) {
    throw new Error("Invalid ciphertext envelope");
  }
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(authTag);
  const pt = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return pt.toString("utf8");
}

module.exports = {
  ONBOARDING_FIELD_ENCRYPTION_KEY,
  CURRENT_KEY_VERSION,
  ALG,
  resolveKeyBytes,
  computeLast4,
  maskDisplay,
  encryptFieldValue,
  decryptFieldValue,
};
