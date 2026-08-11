/**
 * Onboarding portal — public HTTP handlers + run-cancel trigger.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  admin,
  HttpsError,
  PORTAL_SECRET_OPTS,
  REGION,
  UPLOAD_URL_TTL_MS,
  RATE_UPLOAD_LIMIT,
  RATE_UPLOAD_WINDOW_MS,
  db,
  resolvePortalBucket,
  trimStr,
  logPortal,
  clientIp,
  assertRateLimit,
  mintSession,
  revokeActiveTokensForRun,
  resolvePortalAccess,
  resolveSessionAccess,
  buildPortalDto,
  enrichSalonStaffNames,
  recomputeRunInTxn,
} = require("./onboarding-portal-shared");

// ─── Portal HTTP actions (unauthenticated; auth via token/session) ───────────
// Uses onRequest (not onCall+invoker:public) because org policy blocks setting
// Cloud Run invoker IAM from the Firebase CLI on this project.

function httpsErrorToHttp(err) {
  const code = (err && err.code) || "internal";
  const map = {
    "invalid-argument": 400,
    unauthenticated: 401,
    "permission-denied": 403,
    "not-found": 404,
    "failed-precondition": 409,
    aborted: 409,
    "resource-exhausted": 429,
    "deadline-exceeded": 504,
  };
  return map[code] || 500;
}

function wrapPortalHttp(handler) {
  return onRequest(
    {
      region: REGION,
      cors: true,
      ...PORTAL_SECRET_OPTS,
      // invoker omitted — same pattern as mediaDownloadFile on this project
    },
    async (req, res) => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const data = body.data && typeof body.data === "object" ? body.data : body;
        const request = { data, rawRequest: req, auth: null };
        const result = await handler(request);
        res.status(200).json({ result });
      } catch (e) {
        const message =
          (e && e.message) || "Request failed.";
        // Never echo token-like payloads
        logPortal("http_error", {
          message: String(message).slice(0, 200),
          code: e && e.code,
        });
        res.status(httpsErrorToHttp(e)).json({
          error: { message, status: (e && e.code) || "internal" },
        });
      }
    }
  );
}

async function handleBootstrap(request) {
  const ctx = await resolvePortalAccess(request.data && request.data.token, request, {
    allowCompletedRead: true,
    mutating: false,
  });
  const sessionToken = mintSession(ctx);
  const tokenSnap = await ctx.tokenRef.get();
  const t = tokenSnap.data() || {};
  let dto = buildPortalDto(ctx, sessionToken);
  dto.expiresAt =
    t.expiresAt && t.expiresAt.toDate
      ? t.expiresAt.toDate().toISOString()
      : null;
  dto = await enrichSalonStaffNames(dto, ctx.salonId, ctx.staffId);
  logPortal("bootstrap", {
    salonId: ctx.salonId,
    staffId: ctx.staffId,
    runId: ctx.runId,
    tokenId: ctx.tokenId,
    readOnly: ctx.readOnly,
  });
  return dto;
}

async function handleGetState(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const sessionToken = mintSession(ctx);
  const tokenSnap = await ctx.tokenRef.get();
  const t = tokenSnap.data() || {};
  let dto = buildPortalDto(ctx, sessionToken);
  dto.expiresAt =
    t.expiresAt && t.expiresAt.toDate
      ? t.expiresAt.toDate().toISOString()
      : null;
  dto = await enrichSalonStaffNames(dto, ctx.salonId, ctx.staffId);
  return dto;
}

async function handleAckPolicy(request) {
  // Resolve read-first so already-completed policy acks stay idempotent
  // even after the run flips to completed (read-only).
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  const typedName = trimStr(request.data && request.data.typedName);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");

  const existing = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!existing) throw new HttpsError("not-found", "Task not found.");
  if (existing.taskType !== "policy_acknowledgement") {
    throw new HttpsError("failed-precondition", "Not a policy task.");
  }
  if (existing.status === "completed") {
    return buildPortalDto(ctx, mintSession(ctx));
  }
  if (ctx.readOnly || ctx.run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    if (task.taskType !== "policy_acknowledgement") {
      throw new HttpsError("failed-precondition", "Not a policy task.");
    }
    if (task.status === "completed") return;
    const cfg = task.configSnapshot || {};
    if (cfg.requireTypedName === true && !typedName) {
      throw new HttpsError("invalid-argument", "Full name is required.");
    }
    tx.update(taskRef, {
      status: "completed",
      result: {
        acknowledgedAt: admin.firestore.Timestamp.now(),
        acknowledgedByUid: null,
        acknowledgedByName: cfg.requireTypedName ? typedName : null,
        policyVersion: String(cfg.version || "1.0"),
        via: "portal",
      },
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  logPortal("ack_policy", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    tokenId: ctx.tokenId,
  });

  const fresh = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return buildPortalDto(fresh, mintSession(fresh));
}

async function handleCreateUpload(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: true }
  );
  await assertRateLimit(
    `salons/${ctx.salonId}/onboardingPortalRateLimits/up_${ctx.runId}`,
    RATE_UPLOAD_LIMIT,
    RATE_UPLOAD_WINDOW_MS
  );

  const taskId = trimStr(request.data && request.data.taskId);
  const fileName = trimStr(request.data && request.data.fileName).slice(0, 120);
  const contentType =
    trimStr(request.data && request.data.contentType) || "application/octet-stream";
  const size = Number(request.data && request.data.size) || 0;
  if (!taskId || !fileName) {
    throw new HttpsError("invalid-argument", "Missing taskId or fileName.");
  }

  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.taskType !== "document" && task.taskType !== "file_upload") {
    throw new HttpsError("failed-precondition", "Not an upload task.");
  }
  if (task.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }
  const cfg = task.configSnapshot || {};
  const maxMb = Number(cfg.maxSizeMb) || 10;
  if (size > maxMb * 1024 * 1024) {
    throw new HttpsError("invalid-argument", `File must be under ${maxMb} MB.`);
  }

  const uploadId = db()
    .collection(`salons/${ctx.salonId}/onboardingPortalUploads`)
    .doc().id;
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
  const { portalUploadPath } = require("./onboarding-storage-paths");
  const storagePath = portalUploadPath(
    ctx.salonId,
    ctx.staffId,
    ctx.runId,
    taskId,
    uploadId,
    safeName
  );
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + UPLOAD_URL_TTL_MS
  );

  await db()
    .doc(`salons/${ctx.salonId}/onboardingPortalUploads/${uploadId}`)
    .set({
      salonId: ctx.salonId,
      staffId: ctx.staffId,
      runId: ctx.runId,
      taskId,
      tokenId: ctx.tokenId,
      storagePath,
      contentType,
      maxSize: maxMb * 1024 * 1024,
      fileName,
      status: "reserved",
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  const bucket = await resolvePortalBucket();
  const file = bucket.file(storagePath);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType,
  });

  logPortal("create_upload", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    uploadId,
    tokenId: ctx.tokenId,
  });

  return {
    uploadId,
    uploadUrl,
    storagePath,
    contentType,
    expiresAt: expiresAt.toDate().toISOString(),
  };
}

async function handleFinalizeUpload(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: true }
  );
  const uploadId = trimStr(request.data && request.data.uploadId);
  const expirationDate =
    trimStr(request.data && request.data.expirationDate) || null;
  const notes = trimStr(request.data && request.data.notes) || null;
  if (!uploadId) throw new HttpsError("invalid-argument", "Missing uploadId.");

  const uploadRef = db().doc(
    `salons/${ctx.salonId}/onboardingPortalUploads/${uploadId}`
  );
  const uploadSnap = await uploadRef.get();
  if (!uploadSnap.exists) throw new HttpsError("not-found", "Upload not found.");
  const up = uploadSnap.data() || {};
  if (up.status === "finalized" && up.inboxItemId) {
    const fresh = await resolveSessionAccess(
      request.data && request.data.sessionToken,
      request,
      { mutating: false }
    );
    return {
      ok: true,
      inboxItemId: up.inboxItemId,
      state: buildPortalDto(fresh, mintSession(fresh)),
    };
  }
  if (
    trimStr(up.staffId) !== ctx.staffId ||
    trimStr(up.runId) !== ctx.runId ||
    trimStr(up.tokenId) !== ctx.tokenId
  ) {
    throw new HttpsError("permission-denied", "Upload does not match session.");
  }
  const exp = up.expiresAt && up.expiresAt.toMillis ? up.expiresAt.toMillis() : 0;
  if (exp && exp < Date.now() && up.status !== "finalized") {
    throw new HttpsError("deadline-exceeded", "Upload slot expired.");
  }

  const taskId = trimStr(up.taskId);
  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }

  const storagePath = trimStr(up.storagePath);
  const bucket = await resolvePortalBucket();
  const portalFile = bucket.file(storagePath);
  const [exists] = await portalFile.exists();
  if (!exists) {
    throw new HttpsError("failed-precondition", "File not uploaded yet.");
  }
  const [meta] = await portalFile.getMetadata();
  const size = Number(meta.size || 0);
  if (up.maxSize && size > Number(up.maxSize)) {
    throw new HttpsError("invalid-argument", "File too large.");
  }

  const documentType = String(
    task.templateNameSnapshot || task.templateId || "Other"
  ).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const safeName = String(up.fileName || "file")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 80);
  // S1: finalized copy stays under onboardingArtifacts (client Storage deny).
  // Inbox must open via getOnboardingArtifactReadUrl — no long-lived fileUrl.
  const { portalUploadPath } = require("./onboarding-storage-paths");
  const destPath = portalUploadPath(
    ctx.salonId,
    ctx.staffId,
    ctx.runId,
    taskId,
    `${uploadId}_final`,
    safeName
  );
  const destFile = bucket.file(destPath);
  await portalFile.copy(destFile);

  const inboxRef = db().collection(`salons/${ctx.salonId}/inboxItems`).doc();
  await inboxRef.set({
    tenantId: ctx.salonId,
    locationId: null,
    type: "document_upload",
    status: "open",
    priority: "normal",
    assignedTo: null,
    sentToStaffIds: [],
    sentToNames: [],
    data: {
      documentType,
      expirationDate,
      filePath: destPath,
      fileUrl: null,
      storagePath: destPath,
      viaOnboardingArtifacts: true,
      fileName: up.fileName || safeName,
      notes,
      documentOwnerStaffId: ctx.staffId,
      onboardingRunId: ctx.runId,
      onboardingTaskId: taskId,
      templateId: task.templateId || taskId,
      taskType: task.taskType,
      via: "portal",
    },
    managerNotes: null,
    responseNote: null,
    decidedBy: null,
    decidedAt: null,
    needsInfoQuestion: null,
    staffReply: null,
    visibility: "managers_only",
    unreadForManagers: true,
    documentOwnerStaffId: ctx.staffId,
    createdByUid: "onboarding_portal",
    createdByStaffId: ctx.staffId,
    createdByName: "Onboarding Portal",
    createdByRole: "portal",
    forUid: "onboarding_portal",
    forStaffId: ctx.staffId,
    forStaffName: "Onboarding Portal",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: null,
  });

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );
  await db().runTransaction(async (tx) => {
    const ts = await tx.get(taskRef);
    if (!ts.exists) return;
    const cur = ts.data() || {};
    if (cur.status === "completed") return;
    tx.update(taskRef, {
      status: "waiting_approval",
      result: {
        ...(cur.result || {}),
        inboxItemId: inboxRef.id,
        fileName: up.fileName || safeName,
        storagePath: destPath,
        portalUploadId: uploadId,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await uploadRef.set(
    {
      status: "finalized",
      inboxItemId: inboxRef.id,
      destPath,
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  logPortal("finalize_upload", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    uploadId,
    inboxItemId: inboxRef.id,
    tokenId: ctx.tokenId,
  });

  const fresh = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return {
    ok: true,
    inboxItemId: inboxRef.id,
    state: buildPortalDto(fresh, mintSession(fresh)),
  };
}

async function handleGetSignaturePacket(request) {
  const esign = require("./onboarding-esign-seal");
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");
  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.taskType !== "electronic_signature") {
    throw new HttpsError("failed-precondition", "Not an e-sign task.");
  }
  const cfg = esign.esignCfg(task);
  esign.assertEsignAllowed(cfg);

  // Always verify snapshot hash still matches library bytes
  const source = await esign.downloadSourcePdf(ctx.salonId, cfg);
  const bucket = await esign.resolveBucket();
  const [readUrl] = await bucket.file(source.storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + esign.PACKET_URL_TTL_MS,
  });

  const ip = clientIp(request);
  const ua = String(
    (request.rawRequest &&
      request.rawRequest.headers &&
      request.rawRequest.headers["user-agent"]) ||
      ""
  ).slice(0, 300);
  try {
    await esign.writeAudit(
      ctx.salonId,
      ctx.staffId,
      ctx.runId,
      taskId,
      `packet_viewed_${Date.now()}`,
      {
        type: "packet_viewed",
        portalTokenId: ctx.tokenId,
        ip,
        userAgent: ua,
        documentVersionId: source.documentVersionId,
        documentSha256: source.sha,
      }
    );
  } catch (_) {}

  return {
    taskId,
    readOnly: !!ctx.readOnly || task.status === "completed",
    status: task.status || "pending",
    documentTitle: String(cfg.documentTitle || task.templateNameSnapshot || ""),
    documentVersion:
      cfg.documentVersion != null ? cfg.documentVersion : source.documentVersionId,
    pageCount: Number(cfg.pageCount) || null,
    requireTypedName: cfg.requireTypedName === true,
    requireDrawnSignature: cfg.requireDrawnSignature !== false,
    consentText: String(cfg.consentText || ""),
    fieldSchema: esign.publicFieldSchema(cfg.fieldSchema),
    pdfReadUrl: readUrl,
    pdfReadUrlExpiresAt: new Date(
      Date.now() + esign.PACKET_URL_TTL_MS
    ).toISOString(),
    // Intentionally omit IP, source storage path internals beyond signed URL
    resultPublic: esign.publicEsignResult(task.result || {}),
  };
}

async function handleSubmitSignature(request) {
  const esign = require("./onboarding-esign-seal");
  // Read-first so completed stays idempotent after run completes
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");

  const existing = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!existing) throw new HttpsError("not-found", "Task not found.");
  if (existing.taskType !== "electronic_signature") {
    throw new HttpsError("failed-precondition", "Not an e-sign task.");
  }

  const cfg = esign.esignCfg(existing);
  const { documentVersionId } = esign.documentIds(cfg);
  const sealId = esign.sealIdFor(taskId, documentVersionId);

  if (existing.status === "completed" && existing.result && existing.result.sealId) {
    return {
      ok: true,
      alreadyCompleted: true,
      sealId: existing.result.sealId,
      result: esign.publicEsignResult(existing.result),
      state: buildPortalDto(ctx, mintSession(ctx)),
    };
  }

  if (ctx.readOnly || ctx.run.status === "completed" || ctx.run.status === "cancelled") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding cannot accept signatures right now."
    );
  }
  if (existing.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }

  const validated = esign.validateEsignSubmission(existing, request.data || {});
  const ip = clientIp(request);
  const ua = String(
    (request.rawRequest &&
      request.rawRequest.headers &&
      request.rawRequest.headers["user-agent"]) ||
      ""
  ).slice(0, 300);

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );

  // Lock → sealing (or no-op if already sealing/completed)
  let skipSeal = false;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const cur = snap.data() || {};
    if (cur.taskType !== "electronic_signature") {
      throw new HttpsError("failed-precondition", "Not an e-sign task.");
    }
    if (cur.status === "completed" && cur.result && cur.result.sealId) {
      skipSeal = true;
      return;
    }
    if (cur.status === "sealing") {
      // Another request is sealing — allow this request to retry/finish seal
      return;
    }
    if (
      !["pending", "in_progress", "rejected"].includes(String(cur.status || "pending"))
    ) {
      throw new HttpsError(
        "failed-precondition",
        `Task cannot be signed from status ${cur.status}.`
      );
    }
    tx.set(
      taskRef,
      {
        status: "sealing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: {
          ...(cur.result || {}),
          sealId,
          sealingStartedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
  });

  // Re-read if completed during lock
  const freshSnap = await taskRef.get();
  const freshTask = { id: taskId, ...(freshSnap.data() || {}) };
  if (freshTask.status === "completed" && freshTask.result && freshTask.result.sealId) {
    const freshCtx = await resolveSessionAccess(
      request.data && request.data.sessionToken,
      request,
      { mutating: false }
    );
    return {
      ok: true,
      alreadyCompleted: true,
      sealId: freshTask.result.sealId,
      result: esign.publicEsignResult(freshTask.result),
      state: buildPortalDto(freshCtx, mintSession(freshCtx)),
    };
  }

  try {
    await esign.writeAudit(
      ctx.salonId,
      ctx.staffId,
      ctx.runId,
      taskId,
      `submit_accepted_${sealId}`,
      {
        type: "submit_accepted",
        sealId,
        portalTokenId: ctx.tokenId,
        ip,
        userAgent: ua,
        signatureMethod: validated.signatureMethod,
        consentTextVersion: esign.sha256Text(validated.consentText),
        fieldValuesHash: esign.sha256Text(
          JSON.stringify(validated.fieldValues || {})
        ),
      }
    );
  } catch (_) {}

  let sealOut;
  try {
    sealOut = await esign.sealEsignSubmission({
      salonId: ctx.salonId,
      staffId: ctx.staffId,
      runId: ctx.runId,
      taskId,
      task: freshTask,
      tokenId: ctx.tokenId,
      ip,
      userAgent: ua,
      validated,
    });
  } catch (e) {
    // Never leave task completed on failure — revert sealing → in_progress
    try {
      await taskRef.set(
        {
          status: "in_progress",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          result: {
            ...(freshTask.result || {}),
            sealId,
            lastSealError: String((e && e.message) || e).slice(0, 300),
          },
        },
        { merge: true }
      );
    } catch (_) {}
    throw e;
  }

  // Complete task only after seal succeeded
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return;
    const cur = snap.data() || {};
    if (cur.status === "completed" && cur.result && cur.result.signedPdfSha256) {
      return;
    }
    tx.set(
      taskRef,
      {
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedBy: "portal_esign",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: {
          ...(cur.result || {}),
          ...sealOut.result,
          signerName: sealOut.signerName || null,
        },
      },
      { merge: true }
    );
  });

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  const freshCtx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return {
    ok: true,
    alreadyCompleted: !!sealOut.alreadySealed,
    sealId: sealOut.sealId,
    result: esign.publicEsignResult(sealOut.result),
    state: buildPortalDto(freshCtx, mintSession(freshCtx)),
  };
}

exports.onboardingPortalBootstrap = wrapPortalHttp(handleBootstrap);
exports.onboardingPortalGetState = wrapPortalHttp(handleGetState);
exports.onboardingPortalAckPolicy = wrapPortalHttp(handleAckPolicy);
exports.onboardingPortalCreateUpload = wrapPortalHttp(handleCreateUpload);
exports.onboardingPortalFinalizeUpload = wrapPortalHttp(handleFinalizeUpload);
exports.onboardingPortalGetSignaturePacket = wrapPortalHttp(
  handleGetSignaturePacket
);
exports.onboardingPortalSubmitSignature = onRequest(
  {
    region: REGION,
    cors: true,
    timeoutSeconds: 120,
    memory: "1GiB",
    ...PORTAL_SECRET_OPTS,
  },
  async (req, res) => {
    // Same contract as wrapPortalHttp but with higher resources for seal.
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const data = body.data && typeof body.data === "object" ? body.data : body;
      const request = { data, rawRequest: req, auth: null };
      const result = await handleSubmitSignature(request);
      res.status(200).json({ result });
    } catch (e) {
      const message = (e && e.message) || "Request failed.";
      logPortal("http_error", {
        message: String(message).slice(0, 200),
        code: e && e.code,
      });
      res.status(httpsErrorToHttp(e)).json({
        error: { message, status: (e && e.code) || "internal" },
      });
    }
  }
);

// Revoke portal tokens when a run is cancelled.
exports.onOnboardingRunWriteForPortal = onDocumentWritten(
  {
    document:
      "salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}",
    region: REGION,
  },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    const run = after.data() || {};
    if (run.status !== "cancelled") return;
    const before = event.data && event.data.before;
    const prev = before && before.exists ? before.data() || {} : {};
    if (prev.status === "cancelled") return;
    const { salonId, staffId, runId } = event.params || {};
    try {
      const n = await revokeActiveTokensForRun(
        salonId,
        staffId,
        runId,
        "run_cancelled",
        null
      );
      logPortal("auto_revoke_on_cancel", { salonId, staffId, runId, revoked: n });
    } catch (e) {
      console.error("[onboarding-portal] auto revoke failed", e && e.message);
    }
  }
);
