/**
 * Onboarding portal — shared helpers (tokens, sessions, DTO, progress).
 * Consumed by manager / reminders / HTTP modules.
 */

const core = require("./onboarding-portal-shared-core");
const {
  ONBOARDING_PORTAL_HMAC_SECRET,
  PORTAL_SECRET_OPTS,
  REGION,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  SESSION_TTL_MS,
  LAST_USED_THROTTLE_MS,
  UPLOAD_URL_TTL_MS,
  RATE_IP_LIMIT,
  RATE_IP_WINDOW_MS,
  RATE_TOKEN_LIMIT,
  RATE_TOKEN_WINDOW_MS,
  RATE_UPLOAD_LIMIT,
  RATE_UPLOAD_WINDOW_MS,
  db,
  resolvePortalBucket,
  trimStr,
  appBaseUrl,
  sessionSecret,
  sha256Hex,
  generateRawToken,
  tokenDocIdFromHash,
  portalUrl,
  maskEmail,
  logPortal,
  clientIp,
  assertRateLimit,
  assertManager,
  requireManagerAuth,
  mintSession,
  sealRawToken,
  unsealRawToken,
  verifySession,
  sanitizePolicyHtml,
  computeProgress,
  loadRunAndTasks,
  revokeActiveTokensForRun,
  issueTokenCore,
  HttpsError,
  admin,
} = core;

async function resolvePortalAccess(rawToken, request, opts = {}) {
  const allowCompletedRead = opts.allowCompletedRead === true;
  const mutating = opts.mutating === true;
  const ip = clientIp(request);
  await assertRateLimit(
    `onboardingPortalRateLimits/ip_${sha256Hex(ip).slice(0, 24)}`,
    RATE_IP_LIMIT,
    RATE_IP_WINDOW_MS
  );

  const token = trimStr(rawToken);
  if (!token || token.length < 20) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const tokenHash = sha256Hex(token);
  const lookupSnap = await db()
    .doc(`onboardingPortalTokenLookup/${tokenHash}`)
    .get();
  if (!lookupSnap.exists) {
    logPortal("resolve_miss", { hashPrefix: tokenHash.slice(0, 8) });
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const lookup = lookupSnap.data() || {};
  if (lookup.status && lookup.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const salonId = trimStr(lookup.salonId);
  const tokenId = trimStr(lookup.tokenId);
  if (!salonId || !tokenId) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const tokenDoc = await db()
    .doc(`salons/${salonId}/onboardingPortalTokens/${tokenId}`)
    .get();
  if (!tokenDoc.exists) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const t = tokenDoc.data() || {};
  const staffId = trimStr(t.staffId);
  const runId = trimStr(t.runId);

  await assertRateLimit(
    `salons/${salonId}/onboardingPortalRateLimits/tok_${tokenDoc.id}`,
    RATE_TOKEN_LIMIT,
    RATE_TOKEN_WINDOW_MS
  );

  if (t.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
  if (!exp || exp < Date.now()) {
    try {
      const now = admin.firestore.FieldValue.serverTimestamp();
      await tokenDoc.ref.set(
        { status: "expired", updatedAt: now },
        { merge: true }
      );
      await lookupSnap.ref.set({ status: "expired", updatedAt: now }, { merge: true });
    } catch (_) {}
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }

  const { run, tasks, runRef } = await loadRunAndTasks(salonId, staffId, runId);
  if (!run) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  if (run.status === "cancelled") {
    throw new HttpsError("failed-precondition", "This onboarding was cancelled.");
  }
  if (mutating && run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }
  if (!allowCompletedRead && !mutating && run.status === "completed") {
    // getState/bootstrap allow completed — handled by allowCompletedRead
  }

  // Throttled lastUsedAt
  try {
    const last =
      t.lastUsedAt && t.lastUsedAt.toMillis ? t.lastUsedAt.toMillis() : 0;
    if (!last || Date.now() - last > LAST_USED_THROTTLE_MS) {
      await tokenDoc.ref.set(
        {
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
          useCount: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    }
  } catch (_) {}

  return {
    tokenId: tokenDoc.id,
    salonId,
    staffId,
    runId,
    tokenRef: tokenDoc.ref,
    lookupRef: lookupSnap.ref,
    run,
    tasks,
    runRef,
    readOnly: run.status === "completed",
  };
}

async function resolveSessionAccess(sessionToken, request, opts = {}) {
  const claims = verifySession(sessionToken);
  const ip = clientIp(request);
  await assertRateLimit(
    `onboardingPortalRateLimits/ip_${sha256Hex(ip).slice(0, 24)}`,
    RATE_IP_LIMIT,
    RATE_IP_WINDOW_MS
  );
  await assertRateLimit(
    `salons/${claims.salonId}/onboardingPortalRateLimits/tok_${claims.tokenId}`,
    RATE_TOKEN_LIMIT,
    RATE_TOKEN_WINDOW_MS
  );

  const tokenRef = db().doc(
    `salons/${claims.salonId}/onboardingPortalTokens/${claims.tokenId}`
  );
  const tokenSnap = await tokenRef.get();
  if (!tokenSnap.exists) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const t = tokenSnap.data() || {};
  if (t.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
  if (!exp || exp < Date.now()) {
    try {
      await tokenRef.set(
        { status: "expired", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (_) {}
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  if (
    trimStr(t.staffId) !== claims.staffId ||
    trimStr(t.runId) !== claims.runId
  ) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }

  const { run, tasks, runRef } = await loadRunAndTasks(
    claims.salonId,
    claims.staffId,
    claims.runId
  );
  if (!run || run.status === "cancelled") {
    throw new HttpsError("failed-precondition", "This onboarding was cancelled.");
  }
  if (opts.mutating && run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }
  return {
    tokenId: claims.tokenId,
    salonId: claims.salonId,
    staffId: claims.staffId,
    runId: claims.runId,
    tokenRef,
    run,
    tasks,
    runRef,
    readOnly: run.status === "completed",
  };
}

function buildPortalDto(ctx, sessionToken) {
  const { run, tasks, salonId, staffId, readOnly } = ctx;
  const taskDtos = (tasks || []).map((t) => {
    const cfg = t.configSnapshot || {};
    const base = {
      id: t.id,
      templateNameSnapshot: t.templateNameSnapshot || "",
      taskType: t.taskType,
      categoryNameSnapshot: t.categoryNameSnapshot || "",
      required: t.required !== false,
      sortOrder: t.sortOrder || 0,
      status: t.status || "pending",
      resultPublic: {},
    };
    if (t.status === "rejected" && t.result && t.result.rejectionReason) {
      base.resultPublic.rejectionReason = String(t.result.rejectionReason).slice(
        0,
        500
      );
    }
    if (t.taskType === "policy_acknowledgement") {
      base.config = {
        version: String(cfg.version || "1.0"),
        requireTypedName: cfg.requireTypedName === true,
        requireScrollToEnd: cfg.requireScrollToEnd === true,
        bodyHtml: sanitizePolicyHtml(cfg.bodyHtml || ""),
      };
    } else if (t.taskType === "document" || t.taskType === "file_upload") {
      base.config = {
        requiresExpiration: cfg.requiresExpiration === true,
        maxSizeMb: Number(cfg.maxSizeMb) || 10,
        acceptedMime: Array.isArray(cfg.acceptedMime)
          ? cfg.acceptedMime.slice(0, 20)
          : ["application/pdf", "image/*"],
      };
    } else if (t.taskType === "electronic_signature") {
      const esignSeal = require("./onboarding-esign-seal");
      base.config = {
        documentTitle: String(cfg.documentTitle || t.templateNameSnapshot || ""),
        pageCount: Number(cfg.pageCount) || null,
        requireTypedName: cfg.requireTypedName === true,
        requireDrawnSignature: cfg.requireDrawnSignature !== false,
        consentText: String(cfg.consentText || "").slice(0, 4000),
        fieldSchema: esignSeal.publicFieldSchema(cfg.fieldSchema),
        // Never expose IP / hashes of source beyond what's needed for UI
        documentVersion:
          cfg.documentVersion != null ? cfg.documentVersion : null,
      };
      if (t.status === "completed" || t.status === "sealing") {
        base.resultPublic = esignSeal.publicEsignResult(t.result || {});
        // Manager-side task.result may include signerName even if older seals
        // omitted it from resultPublic — prefer result, fall back to public.
        if (
          !base.resultPublic.signerName &&
          t.result &&
          t.result.signerName
        ) {
          base.resultPublic.signerName = String(t.result.signerName).slice(
            0,
            120
          );
        }
      }
    } else {
      base.config = {};
    }
    return base;
  });

  return {
    sessionToken: sessionToken || null,
    readOnly: !!readOnly,
    expiresAt: null, // filled by caller from token
    salon: { id: salonId },
    staff: { id: staffId },
    run: {
      id: run.id,
      status: run.status,
      progress: run.progress || null,
      dueDate: run.dueDate || null,
      packageNameSnapshot: run.packageNameSnapshot || "",
      packageDescriptionSnapshot: run.packageDescriptionSnapshot || "",
    },
    tasks: taskDtos,
  };
}

async function enrichSalonStaffNames(dto, salonId, staffId) {
  try {
    const [salonSnap, staffSnap] = await Promise.all([
      db().doc(`salons/${salonId}`).get(),
      db().doc(`salons/${salonId}/staff/${staffId}`).get(),
    ]);
    if (salonSnap.exists) {
      const s = salonSnap.data() || {};
      dto.salon.name = String(s.name || s.salonName || "Salon");
    }
    if (staffSnap.exists) {
      const st = staffSnap.data() || {};
      dto.staff.displayName = String(st.name || st.displayName || "Team member");
    }
  } catch (_) {}
  return dto;
}

async function recomputeRunInTxn(salonId, staffId, runId) {
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  await db().runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) return;
    const run = runSnap.data() || {};
    if (run.status === "cancelled") return;
    const tasksSnap = await tx.get(
      db().collection(
        `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`
      )
    );
    const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { progress, status } = computeProgress(tasks, run.status);
    const patch = {
      progress,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === "completed" && run.status !== "completed") {
      patch.completedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.update(runRef, patch);
  });
}


module.exports = {
  ONBOARDING_PORTAL_HMAC_SECRET,
  PORTAL_SECRET_OPTS,
  REGION,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  SESSION_TTL_MS,
  LAST_USED_THROTTLE_MS,
  UPLOAD_URL_TTL_MS,
  RATE_IP_LIMIT,
  RATE_IP_WINDOW_MS,
  RATE_TOKEN_LIMIT,
  RATE_TOKEN_WINDOW_MS,
  RATE_UPLOAD_LIMIT,
  RATE_UPLOAD_WINDOW_MS,
  db,
  resolvePortalBucket,
  trimStr,
  appBaseUrl,
  sessionSecret,
  sha256Hex,
  generateRawToken,
  tokenDocIdFromHash,
  portalUrl,
  maskEmail,
  logPortal,
  clientIp,
  assertRateLimit,
  assertManager,
  requireManagerAuth,
  mintSession,
  sealRawToken,
  unsealRawToken,
  verifySession,
  sanitizePolicyHtml,
  computeProgress,
  loadRunAndTasks,
  revokeActiveTokensForRun,
  issueTokenCore,
  resolvePortalAccess,
  resolveSessionAccess,
  buildPortalDto,
  enrichSalonStaffNames,
  recomputeRunInTxn,
  HttpsError,
  admin,
};
