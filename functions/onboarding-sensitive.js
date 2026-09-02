/**
 * Employee Onboarding S2 — sensitive field store + Reveal.
 *
 * Callables:
 *   storeOnboardingSensitiveField  — encrypt + write ciphertext/last4 (manager)
 *   revealOnboardingSensitiveField — decrypt once + audit (owner/admin or
 *                                    permissions.onboarding_reveal_sensitive)
 *
 * Deploy (staging):
 *   firebase functions:secrets:set ONBOARDING_FIELD_ENCRYPTION_KEY --project fair-flow-staging
 *   firebase deploy --only \
 *     functions:storeOnboardingSensitiveField,functions:revealOnboardingSensitiveField \
 *     --project fair-flow-staging
 */

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  ONBOARDING_FIELD_ENCRYPTION_KEY,
  encryptFieldValue,
  decryptFieldValue,
  maskDisplay,
} = require("./onboarding-crypto");

if (!admin.apps.length) admin.initializeApp();

const REGION = "us-central1";

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

function clientIp(request) {
  try {
    const raw =
      request.rawRequest &&
      (request.rawRequest.headers["x-forwarded-for"] ||
        request.rawRequest.ip);
    if (!raw) return null;
    return String(raw).split(",")[0].trim().slice(0, 64) || null;
  } catch (_) {
    return null;
  }
}

function taskRef(salonId, staffId, runId, taskId) {
  return db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks/${taskId}`
  );
}

function runRef(salonId, staffId, runId) {
  return db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
}

/**
 * Owner / admin always; else staff permission onboarding_reveal_sensitive.
 */
async function assertCanRevealSensitive(uid, salonId) {
  const [userSnap, salonSnap, memberSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
  ]);
  if (!salonSnap.exists) throw new HttpsError("not-found", "Salon not found.");
  if (salonSnap.get("ownerUid") === uid) {
    return { role: "owner", reveal: true };
  }

  const u = userSnap.exists ? userSnap.data() || {} : {};
  const userRole = trimStr(u.role).toLowerCase();
  if (
    trimStr(u.salonId) === salonId &&
    (userRole === "owner" || userRole === "admin")
  ) {
    return { role: userRole, reveal: true };
  }

  const m = memberSnap.exists ? memberSnap.data() || {} : {};
  const memberRole = trimStr(m.role).toLowerCase();
  if (memberRole === "owner" || memberRole === "admin") {
    return { role: memberRole, reveal: true };
  }

  const staffId = trimStr(u.staffId) || trimStr(m.staffId);
  if (trimStr(u.salonId) === salonId && staffId) {
    const staffSnap = await db()
      .doc(`salons/${salonId}/staff/${staffId}`)
      .get();
    if (staffSnap.exists) {
      const perms = (staffSnap.data() || {}).permissions || {};
      if (perms.onboarding_reveal_sensitive === true) {
        return {
          role: userRole || memberRole || "staff",
          reveal: true,
          revealPermission: true,
        };
      }
      const staffRole = trimStr(staffSnap.get("role")).toLowerCase();
      if (staffRole === "owner" || staffRole === "admin") {
        return { role: staffRole, reveal: true };
      }
    }
  }

  throw new HttpsError(
    "permission-denied",
    "Only owners/admins (or staff with onboarding_reveal_sensitive) can reveal sensitive fields."
  );
}

/** Managers who can start onboarding may store encrypted values (S2/S4). */
async function assertCanStoreSensitive(uid, salonId) {
  const { assertManager } = require("./onboarding-portal-shared-core");
  return assertManager(uid, salonId);
}

async function appendRunAudit(runPathRef, eventId, payload) {
  await runPathRef
    .collection("auditEvents")
    .doc(eventId)
    .set(
      {
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * storeOnboardingSensitiveField
 * data: { salonId, staffId, runId, taskId, fieldId, plaintext, sensitiveKind?, label? }
 */
exports.storeOnboardingSensitiveField = onCall(
  { region: REGION, secrets: [ONBOARDING_FIELD_ENCRYPTION_KEY] },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const fieldId = trimStr(request.data && request.data.fieldId);
    const plaintext = request.data && request.data.plaintext;
    const sensitiveKind =
      trimStr(request.data && request.data.sensitiveKind) || "other";
    const label = trimStr(request.data && request.data.label);

    if (!salonId || !staffId || !runId || !taskId || !fieldId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, staffId, runId, taskId, or fieldId."
      );
    }
    if (plaintext == null || String(plaintext) === "") {
      throw new HttpsError("invalid-argument", "plaintext is required.");
    }
    if (String(plaintext).length > 500) {
      throw new HttpsError("invalid-argument", "plaintext too long.");
    }

    await assertCanStoreSensitive(uid, salonId);

    let envelope;
    try {
      envelope = encryptFieldValue(plaintext, { sensitiveKind });
    } catch (e) {
      console.error("[OnboardingSensitive] encrypt failed", e && e.message);
      throw new HttpsError(
        "failed-precondition",
        "Encryption key is not configured correctly."
      );
    }

    const tref = taskRef(salonId, staffId, runId, taskId);
    const rref = runRef(salonId, staffId, runId);
    const [tsnap, rsnap] = await Promise.all([tref.get(), rref.get()]);
    if (!rsnap.exists) throw new HttpsError("not-found", "Run not found.");
    if (!tsnap.exists) throw new HttpsError("not-found", "Task not found.");

    const task = tsnap.data() || {};
    const result = { ...(task.result || {}) };
    const encMap = {
      ...(result.fieldValuesEncrypted &&
      typeof result.fieldValuesEncrypted === "object"
        ? result.fieldValuesEncrypted
        : {}),
    };
    const pubMap = {
      ...(result.fieldValuesPublic &&
      typeof result.fieldValuesPublic === "object"
        ? result.fieldValuesPublic
        : {}),
    };

    encMap[fieldId] = envelope;
    pubMap[fieldId] = {
      type: "text",
      sensitive: true,
      sensitiveKind,
      last4: envelope.last4,
      displayValue: maskDisplay(envelope.last4, sensitiveKind),
      label: label || fieldId,
    };

    await tref.set(
      {
        result: {
          ...result,
          fieldValuesEncrypted: encMap,
          fieldValuesPublic: pubMap,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const eventId = `sensitive_store_${taskId}_${fieldId}`;
    await appendRunAudit(rref, eventId, {
      action: "sensitive_store",
      performedByUid: uid,
      staffId,
      runId,
      taskId,
      fieldId,
      sensitiveKind,
      last4: envelope.last4,
      ip: clientIp(request),
    });

    return {
      ok: true,
      fieldId,
      last4: envelope.last4,
      displayValue: maskDisplay(envelope.last4, sensitiveKind),
      keyVersion: envelope.keyVersion,
    };
  }
);

/**
 * revealOnboardingSensitiveField
 * data: { salonId, staffId, runId, taskId, fieldId }
 * Returns plaintext once; does not persist plaintext.
 */
exports.revealOnboardingSensitiveField = onCall(
  { region: REGION, secrets: [ONBOARDING_FIELD_ENCRYPTION_KEY] },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const fieldId = trimStr(request.data && request.data.fieldId);

    if (!salonId || !staffId || !runId || !taskId || !fieldId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, staffId, runId, taskId, or fieldId."
      );
    }

    let authz;
    try {
      authz = await assertCanRevealSensitive(uid, salonId);
    } catch (e) {
      // Optional denied audit (rate-limit friendly: one doc per minute)
      try {
        const rref = runRef(salonId, staffId, runId);
        const minute = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
        await appendRunAudit(
          rref,
          `sensitive_reveal_denied_${taskId}_${fieldId}_${minute}`,
          {
            action: "sensitive_reveal_denied",
            performedByUid: uid,
            staffId,
            runId,
            taskId,
            fieldId,
            ip: clientIp(request),
          }
        );
      } catch (_) {
        /* ignore */
      }
      throw e;
    }

    const tref = taskRef(salonId, staffId, runId, taskId);
    const rref = runRef(salonId, staffId, runId);
    const tsnap = await tref.get();
    if (!tsnap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = tsnap.data() || {};
    const encMap =
      (task.result && task.result.fieldValuesEncrypted) || {};
    const blob = encMap[fieldId];
    if (!blob) {
      throw new HttpsError(
        "not-found",
        "No encrypted value for this field."
      );
    }

    let plaintext;
    try {
      plaintext = decryptFieldValue(blob);
    } catch (e) {
      console.error("[OnboardingSensitive] decrypt failed", e && e.message);
      throw new HttpsError(
        "failed-precondition",
        "Could not decrypt field (key mismatch or corrupt data)."
      );
    }

    const eventId = `sensitive_reveal_${taskId}_${fieldId}_${Date.now()}`;
    await appendRunAudit(rref, eventId, {
      action: "sensitive_reveal",
      performedByUid: uid,
      performedAs: authz.role,
      staffId,
      runId,
      taskId,
      fieldId,
      sensitiveKind: blob.sensitiveKind || "other",
      last4: blob.last4 || null,
      ip: clientIp(request),
    });

    return {
      fieldId,
      plaintext,
      last4: blob.last4 || null,
      sensitiveKind: blob.sensitiveKind || "other",
      displayValue: maskDisplay(blob.last4, blob.sensitiveKind),
      revealedAt: new Date().toISOString(),
    };
  }
);
