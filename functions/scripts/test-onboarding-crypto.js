/**
 * S2 unit check — AES-GCM roundtrip (no Secret Manager).
 *   cd functions && node scripts/test-onboarding-crypto.js
 */
const assert = require("assert");
const crypto = require("crypto");

process.env.ONBOARDING_FIELD_ENCRYPTION_KEY = crypto
  .randomBytes(32)
  .toString("base64");

const {
  encryptFieldValue,
  decryptFieldValue,
  maskDisplay,
  computeLast4,
} = require("../onboarding-crypto");

function run() {
  const ssn = "123-45-6789";
  const enc = encryptFieldValue(ssn, { sensitiveKind: "ssn" });
  assert.strictEqual(enc.alg, "AES-256-GCM");
  assert.strictEqual(enc.last4, "6789");
  assert.strictEqual(enc.sensitiveKind, "ssn");
  assert.ok(enc.ciphertext);
  assert.ok(enc.iv);
  assert.ok(enc.authTag);

  const plain = decryptFieldValue(enc);
  assert.strictEqual(plain, ssn);
  assert.strictEqual(maskDisplay(enc.last4, "ssn"), "***-**-6789");
  assert.strictEqual(computeLast4("9911223344", "bank_account"), "3344");

  // Tamper auth tag → must fail
  let failed = false;
  try {
    decryptFieldValue({ ...enc, authTag: Buffer.alloc(16).toString("base64") });
  } catch (_) {
    failed = true;
  }
  assert.strictEqual(failed, true);

  console.log("ok — onboarding-crypto roundtrip + mask + tamper check");
}

run();
